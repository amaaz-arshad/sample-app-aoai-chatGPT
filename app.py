import copy
import json
import os
import logging
import uuid
import httpx
import asyncio
import requests
# from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.storage.blob import BlobServiceClient
from quart import (
    Blueprint,
    Quart,
    jsonify,
    make_response,
    request,
    send_from_directory,
    render_template,
    current_app,
)

from openai import AsyncAzureOpenAI
from azure.identity.aio import (
    DefaultAzureCredential,
    get_bearer_token_provider
)
from backend.auth.auth_utils import get_authenticated_user_details
from backend.security.ms_defender_utils import get_msdefender_user_json
from backend.history.cosmosdbservice import CosmosConversationClient
from backend.settings import (
    app_settings,
    MINIMUM_SUPPORTED_AZURE_OPENAI_PREVIEW_API_VERSION
)
from backend.utils import (
    format_as_ndjson,
    format_stream_response,
    format_non_streaming_response,
    convert_to_pf_format,
    format_pf_non_streaming_response,
)
from dotenv import load_dotenv
import pymupdf4llm
import time
import tempfile
from azure.cosmos import CosmosClient, PartitionKey
from sentence_transformers import SentenceTransformer

# from rake_nltk import Rake

# Initialize RAKE
# rake = Rake()

load_dotenv() 

# model = SentenceTransformer(app_settings.azure_openai.embedding_name)
model = SentenceTransformer("sentence-transformers/multi-qa-mpnet-base-dot-v1")
cosmos_account_uri = f"https://{app_settings.chat_history.account}.documents.azure.com:443/"

cosmos_client = CosmosClient(cosmos_account_uri, credential=os.getenv("A_AZURE_COSMOS_ACCOUNT_KEY"))
collection_name = 'system_messages'
# Define Cosmos DB collection name for storing user system messages
USER_SYSTEM_MESSAGE_COLLECTION = "user_system_message"

# Azure OpenAI API endpoint and key
openai_api_base = app_settings.azure_openai.endpoint
openai_api_key = app_settings.azure_openai.key
openai_api_version = app_settings.azure_openai.preview_api_version
print(f"openai_api_version:",openai_api_version)
embedding_deployment = app_settings.azure_openai.embedding_name
# embedding_deployment = "text-embedding-3-large"

# Azure Cognitive Search endpoint, index name, and API key
service_endpoint = app_settings.datasource.model_dump(by_alias=True).get("endpoint")
print(f"service_endpoint:",service_endpoint)
# index_name = "pdf-large-vector-index"
index_name = app_settings.datasource.model_dump(by_alias=True).get("index_name")
print(f"index_name:",index_name)
api_key = os.getenv("AZURE_SEARCH_KEY")

# Azure Blob Storage endpoint and container
blob_service_url = os.getenv("A_AZURE_BLOB_URL")
# container_name = "pdf-container2"
container_name = os.getenv("A_AZURE_BLOB_CONTAINER_NAME")
storage_key = os.getenv("A_AZURE_BLOB_STORAGE_KEY")
blob_service_client = BlobServiceClient(account_url=blob_service_url, credential=storage_key)

# Create a SearchClient instance
search_client = SearchClient(service_endpoint, index_name, AzureKeyCredential(api_key))

# Initialize the Document Intelligence Client
# document_intelligence_client = DocumentIntelligenceClient(
#     endpoint=os.getenv("A_AZURE_DOC_INTELLIGENCE_ENDPOINT"), 
#     credential=AzureKeyCredential(os.getenv("A_AZURE_DOC_INTELLIGENCE_KEY"))
# )

bp = Blueprint("routes", __name__, static_folder="static", template_folder="static")

cosmos_db_ready = asyncio.Event()


def create_app():
    app = Quart(__name__)
    app.register_blueprint(bp)
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    # Allow files up to 1000MB
    app.config["MAX_CONTENT_LENGTH"] = 1000 * 1024 * 1024
    
    @app.before_serving
    async def init():
        try:
            app.cosmos_conversation_client = await init_cosmosdb_client()
            cosmos_db_ready.set()
        except Exception as e:
            logging.exception("Failed to initialize CosmosDB client")
            app.cosmos_conversation_client = None
            raise e
    
    return app


@bp.route("/")
async def index():
    return await render_template(
        "index.html",
        title=app_settings.ui.title,
        favicon=app_settings.ui.favicon
    )


@bp.route("/favicon.ico")
async def favicon():
    return await bp.send_static_file("favicon.ico")


@bp.route("/assets/<path:path>")
async def assets(path):
    return await send_from_directory("static/assets", path)


# Debug settings
DEBUG = os.environ.get("DEBUG", "false")
if DEBUG.lower() == "true":
    logging.basicConfig(level=logging.DEBUG)

USER_AGENT = "GitHubSampleWebApp/AsyncAzureOpenAI/1.0.0"


# Frontend Settings via Environment Variables
frontend_settings = {
    "auth_enabled": app_settings.base_settings.auth_enabled,
    "feedback_enabled": (
        app_settings.chat_history and
        app_settings.chat_history.enable_feedback
    ),
    "ui": {
        "title": app_settings.ui.title,
        "logo": app_settings.ui.logo,
        "chat_logo": app_settings.ui.chat_logo or app_settings.ui.logo,
        "chat_title": app_settings.ui.chat_title,
        "chat_description": app_settings.ui.chat_description,
        "show_share_button": app_settings.ui.show_share_button,
        "show_chat_history_button": app_settings.ui.show_chat_history_button,
    },
    "sanitize_answer": app_settings.base_settings.sanitize_answer,
    "oyd_enabled": app_settings.base_settings.datasource_type,
}


# Enable Microsoft Defender for Cloud Integration
MS_DEFENDER_ENABLED = os.environ.get("MS_DEFENDER_ENABLED", "true").lower() == "true"


# Initialize Azure OpenAI Client
async def init_openai_client():
    azure_openai_client = None
    
    try:
        # API version check
        if (
            app_settings.azure_openai.preview_api_version
            < MINIMUM_SUPPORTED_AZURE_OPENAI_PREVIEW_API_VERSION
        ):
            raise ValueError(
                f"The minimum supported Azure OpenAI preview API version is '{MINIMUM_SUPPORTED_AZURE_OPENAI_PREVIEW_API_VERSION}'"
            )

        # Endpoint
        if (
            not app_settings.azure_openai.endpoint and
            not app_settings.azure_openai.resource
        ):
            raise ValueError(
                "AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_RESOURCE is required"
            )

        endpoint = (
            app_settings.azure_openai.endpoint
            if app_settings.azure_openai.endpoint
            else f"https://{app_settings.azure_openai.resource}.openai.azure.com/"
        )

        # Authentication
        aoai_api_key = app_settings.azure_openai.key
        ad_token_provider = None
        if not aoai_api_key:
            logging.debug("No AZURE_OPENAI_KEY found, using Azure Entra ID auth")
            async with DefaultAzureCredential() as credential:
                ad_token_provider = get_bearer_token_provider(
                    credential,
                    "https://cognitiveservices.azure.com/.default"
                )

        # Deployment
        deployment = app_settings.azure_openai.model
        if not deployment:
            raise ValueError("AZURE_OPENAI_MODEL is required")

        # Default Headers
        default_headers = {"x-ms-useragent": USER_AGENT}

        azure_openai_client = AsyncAzureOpenAI(
            api_version=app_settings.azure_openai.preview_api_version,
            api_key=aoai_api_key,
            azure_ad_token_provider=ad_token_provider,
            default_headers=default_headers,
            azure_endpoint=endpoint,
        )

        return azure_openai_client
    except Exception as e:
        logging.exception("Exception in Azure OpenAI initialization", e)
        azure_openai_client = None
        raise e


async def init_cosmosdb_client():
    cosmos_conversation_client = None
    if app_settings.chat_history:
        try:
            cosmos_endpoint = (
                f"https://{app_settings.chat_history.account}.documents.azure.com:443/"
            )

            if not app_settings.chat_history.account_key:
                async with DefaultAzureCredential() as cred:
                    credential = cred
                    
            else:
                credential = app_settings.chat_history.account_key

            cosmos_conversation_client = CosmosConversationClient(
                cosmosdb_endpoint=cosmos_endpoint,
                credential=credential,
                database_name=app_settings.chat_history.database,
                container_name=app_settings.chat_history.conversations_container,
                enable_message_feedback=app_settings.chat_history.enable_feedback,
            )
        except Exception as e:
            logging.exception("Exception in CosmosDB initialization", e)
            cosmos_conversation_client = None
            raise e
    else:
        logging.debug("CosmosDB not configured")

    return cosmos_conversation_client


async def prepare_model_args(request_body, request_headers):
    request_messages = request_body.get("messages", [])
    messages = []

    # Retrieve the system message from Cosmos DB for the authenticated user
    authenticated_user = get_authenticated_user_details(request_headers)
    user_id = authenticated_user["user_principal_id"]
    system_message = app_settings.azure_openai.system_message  # Fallback value in case no custom message is found

    try:
        # Get the CosmosDB container for system messages
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        container = database.get_container_client(USER_SYSTEM_MESSAGE_COLLECTION)

        # Query for the system message for the authenticated user
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))

        if results:
            # If a system message exists for the user, use that
            system_message = results[0]["system_message"]
    except Exception as e:
        logging.error(f"Error retrieving system message for user {user_id}: {e}")

    # Add the system message to the messages array
    if not app_settings.datasource:
        messages = [
            {
                "role": "system",
                "content": system_message 
            }
        ]
    
    for message in request_messages:
        if message:
            if message["role"] == "assistant" and "context" in message:
                context_obj = json.loads(message["context"])
                messages.append(
                    {
                        "role": message["role"],
                        "content": message["content"],
                        "context": context_obj
                    }
                )
            else:
                messages.append(
                    {
                        "role": message["role"],
                        "content": message["content"]
                    }
                )

    user_json = None
    if MS_DEFENDER_ENABLED:
        authenticated_user_details = get_authenticated_user_details(request_headers)
        conversation_id = request_body.get("conversation_id", None)
        application_name = app_settings.ui.title
        user_json = get_msdefender_user_json(authenticated_user_details, request_headers, conversation_id, application_name)

    model_args = {
        "messages": messages,
        "temperature": app_settings.azure_openai.temperature,
        "max_tokens": app_settings.azure_openai.max_tokens,
        "top_p": app_settings.azure_openai.top_p,
        "stop": app_settings.azure_openai.stop_sequence,
        "stream": app_settings.azure_openai.stream,
        "model": app_settings.azure_openai.model,
        "user": user_json
    }
    
    if app_settings.datasource:
        # Get the existing data source configuration
        data_source_config = app_settings.datasource.construct_payload_configuration(request=request)

        # Ensure "parameters" exists in the data source configuration
        if "parameters" not in data_source_config:
            data_source_config["parameters"] = {}

        # Assign retrieved system message to role_information
        data_source_config["parameters"]["role_information"] = system_message
        
        # Get the companyName from the request body
        companyName = request_body.get("companyName")

        # Apply the filter only if companyName has a value
        if companyName:
            # Convert companyName to lowercase
            companyName = companyName.strip().lower().strip('.')
            data_source_config["parameters"]["filter"] = f"organization eq '{companyName}'"

        print("endpoint url: " + request.url_root.rstrip("/") + "/embed")
        data_source_config["parameters"]["embedding_dependency"] = {
            "type": "endpoint",
            "endpoint": app_settings.azure_openai.embedding_endpoint, 
            "authentication": {
              "type": "api_key",
              "key": app_settings.azure_openai.embedding_key
            }
        }
        
        # Store the configuration into the extra_body
        model_args["extra_body"] = {
            "data_sources": [
                data_source_config
            ]
        }

    model_args_clean = copy.deepcopy(model_args)
    if model_args_clean.get("extra_body"):
        secret_params = [
            "key",
            "connection_string",
            "embedding_key",
            "encoded_api_key",
            "api_key",
        ]
        for secret_param in secret_params:
            if model_args_clean["extra_body"]["data_sources"][0]["parameters"].get(
                secret_param
            ):
                model_args_clean["extra_body"]["data_sources"][0]["parameters"][
                    secret_param
                ] = "*****"
        authentication = model_args_clean["extra_body"]["data_sources"][0][
            "parameters"
        ].get("authentication", {})
        for field in authentication:
            if field in secret_params:
                model_args_clean["extra_body"]["data_sources"][0]["parameters"][
                    "authentication"
                ][field] = "*****"
        embeddingDependency = model_args_clean["extra_body"]["data_sources"][0][
            "parameters"
        ].get("embedding_dependency", {})
        if "authentication" in embeddingDependency:
            for field in embeddingDependency["authentication"]:
                if field in secret_params:
                    model_args_clean["extra_body"]["data_sources"][0]["parameters"][
                        "embedding_dependency"
                    ]["authentication"][field] = "*****"

    logging.debug(f"REQUEST BODY: {json.dumps(model_args_clean, indent=4)}")

    print(f"model_args: {model_args}")
    return model_args


async def promptflow_request(request):
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {app_settings.promptflow.api_key}",
        }
        # Adding timeout for scenarios where response takes longer to come back
        logging.debug(f"Setting timeout to {app_settings.promptflow.response_timeout}")
        async with httpx.AsyncClient(
            timeout=float(app_settings.promptflow.response_timeout)
        ) as client:
            pf_formatted_obj = convert_to_pf_format(
                request,
                app_settings.promptflow.request_field_name,
                app_settings.promptflow.response_field_name
            )
            # NOTE: This only support question and chat_history parameters
            # If you need to add more parameters, you need to modify the request body
            response = await client.post(
                app_settings.promptflow.endpoint,
                json={
                    app_settings.promptflow.request_field_name: pf_formatted_obj[-1]["inputs"][app_settings.promptflow.request_field_name],
                    "chat_history": pf_formatted_obj[:-1],
                },
                headers=headers,
            )
        resp = response.json()
        resp["id"] = request["messages"][-1]["id"]
        return resp
    except Exception as e:
        logging.error(f"An error occurred while making promptflow_request: {e}")


async def send_chat_request(request_body, request_headers):
    filtered_messages = []
    messages = request_body.get("messages", [])
    for message in messages:
        if message.get("role") != 'tool':
            filtered_messages.append(message)
            
    request_body['messages'] = filtered_messages
    model_args = await prepare_model_args(request_body, request_headers)

    try:
        azure_openai_client = await init_openai_client()
        raw_response = await azure_openai_client.chat.completions.with_raw_response.create(**model_args)
        response = raw_response.parse()
        apim_request_id = raw_response.headers.get("apim-request-id") 
    except Exception as e:
        logging.exception("Exception in send_chat_request")
        raise e

    return response, apim_request_id


async def complete_chat_request(request_body, request_headers):
    if app_settings.base_settings.use_promptflow:
        response = await promptflow_request(request_body)
        history_metadata = request_body.get("history_metadata", {})
        return format_pf_non_streaming_response(
            response,
            history_metadata,
            app_settings.promptflow.response_field_name,
            app_settings.promptflow.citations_field_name
        )
    else:
        response, apim_request_id = await send_chat_request(request_body, request_headers)
        history_metadata = request_body.get("history_metadata", {})
        return format_non_streaming_response(response, history_metadata, apim_request_id)


async def stream_chat_request(request_body, request_headers):
    response, apim_request_id = await send_chat_request(request_body, request_headers)
    history_metadata = request_body.get("history_metadata", {})
    
    async def generate():
        async for completionChunk in response:
            yield format_stream_response(completionChunk, history_metadata, apim_request_id)

    return generate()


async def conversation_internal(request_body, request_headers):
    try:
        if app_settings.azure_openai.stream and not app_settings.base_settings.use_promptflow:
            result = await stream_chat_request(request_body, request_headers)
            response = await make_response(format_as_ndjson(result))
            response.timeout = None
            response.mimetype = "application/json-lines"
            return response
        else:
            result = await complete_chat_request(request_body, request_headers)
            return jsonify(result)

    except Exception as ex:
        logging.exception(ex)
        if hasattr(ex, "status_code"):
            return jsonify({"error": str(ex)}), ex.status_code
        else:
            return jsonify({"error": str(ex)}), 500


@bp.route("/conversation", methods=["POST"])
async def conversation():
    if not request.is_json:
        return jsonify({"error": "request must be json"}), 415
    request_json = await request.get_json()

    return await conversation_internal(request_json, request.headers)


@bp.route("/frontend_settings", methods=["GET"])
def get_frontend_settings():
    try:
        return jsonify(frontend_settings), 200
    except Exception as e:
        logging.exception("Exception in /frontend_settings")
        return jsonify({"error": str(e)}), 500


## Conversation History API ##
@bp.route("/history/generate", methods=["POST"])
async def add_conversation():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    try:
        # make sure cosmos is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        # check for the conversation_id, if the conversation is not set, we will create a new one
        history_metadata = {}
        if not conversation_id:
            title = await generate_title(request_json["messages"])
            conversation_dict = await current_app.cosmos_conversation_client.create_conversation(
                user_id=user_id, title=title
            )
            conversation_id = conversation_dict["id"]
            history_metadata["title"] = title
            history_metadata["date"] = conversation_dict["createdAt"]

        ## Format the incoming message object in the "chat/completions" messages format
        ## then write it to the conversation history in cosmos
        messages = request_json["messages"]
        if len(messages) > 0 and messages[-1]["role"] == "user":
            createdMessageValue = await current_app.cosmos_conversation_client.create_message(
                uuid=str(uuid.uuid4()),
                conversation_id=conversation_id,
                user_id=user_id,
                input_message=messages[-1],
            )
            if createdMessageValue == "Conversation not found":
                raise Exception(
                    "Conversation not found for the given conversation ID: "
                    + conversation_id
                    + "."
                )
        else:
            raise Exception("No user message found")
        
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        existing_collections = [coll['id'] for coll in database.list_containers()]

        if collection_name not in existing_collections:
            database.create_container(id=collection_name, partition_key=PartitionKey(path='/conversation_id'))
            print(f"Created collection '{collection_name}'.")
        else:
            print(f"Collection '{collection_name}' already exists.")
        
        # Retrieve system message from the 'user_system_message' collection
        container = database.get_container_client(USER_SYSTEM_MESSAGE_COLLECTION)
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))

        # Use the system message from the collection if it exists, otherwise fallback to default value
        if results:
            system_message = results[0]["system_message"]
        else:
            system_message = app_settings.azure_openai.system_message  # Fallback value

        system_message_entry = {
            'id': str(uuid.uuid4()),  # Unique identifier for the system message
            'conversation_id': conversation_id,
            'system_message': system_message
        }

        container = database.get_container_client(collection_name)
        container.create_item(system_message_entry)
        print(f"Inserted system message for conversation ID '{conversation_id}'.")

        # Submit request to Chat Completions for response
        request_body = await request.get_json()
        history_metadata["conversation_id"] = conversation_id
        request_body["history_metadata"] = history_metadata
        return await conversation_internal(request_body, request.headers)

    except Exception as e:
        logging.exception("Exception in /history/generate")
        return jsonify({"error": str(e)}), 500

@bp.route("/history/update", methods=["POST"])
async def update_conversation():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    try:
        # make sure cosmos is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        # check for the conversation_id, if the conversation is not set, we will create a new one
        if not conversation_id:
            raise Exception("No conversation_id found")

        ## Format the incoming message object in the "chat/completions" messages format
        ## then write it to the conversation history in cosmos
        messages = request_json["messages"]
        if len(messages) > 0 and messages[-1]["role"] == "assistant":
            if len(messages) > 1 and messages[-2].get("role", None) == "tool":
                # write the tool message first
                await current_app.cosmos_conversation_client.create_message(
                    uuid=str(uuid.uuid4()),
                    conversation_id=conversation_id,
                    user_id=user_id,
                    input_message=messages[-2],
                )
            # write the assistant message
            await current_app.cosmos_conversation_client.create_message(
                uuid=messages[-1]["id"],
                conversation_id=conversation_id,
                user_id=user_id,
                input_message=messages[-1],
            )
        else:
            raise Exception("No bot messages found")

        # Submit request to Chat Completions for response
        response = {"success": True}
        return jsonify(response), 200

    except Exception as e:
        logging.exception("Exception in /history/update")
        return jsonify({"error": str(e)}), 500


@bp.route("/history/message_feedback", methods=["POST"])
async def update_message():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for message_id
    request_json = await request.get_json()
    message_id = request_json.get("message_id", None)
    message_feedback = request_json.get("message_feedback", None)
    try:
        if not message_id:
            return jsonify({"error": "message_id is required"}), 400

        if not message_feedback:
            return jsonify({"error": "message_feedback is required"}), 400

        ## update the message in cosmos
        updated_message = await current_app.cosmos_conversation_client.update_message_feedback(
            user_id, message_id, message_feedback
        )
        if updated_message:
            return (
                jsonify(
                    {
                        "message": f"Successfully updated message with feedback {message_feedback}",
                        "message_id": message_id,
                    }
                ),
                200,
            )
        else:
            return (
                jsonify(
                    {
                        "error": f"Unable to update message {message_id}. It either does not exist or the user does not have access to it."
                    }
                ),
                404,
            )

    except Exception as e:
        logging.exception("Exception in /history/message_feedback")
        return jsonify({"error": str(e)}), 500


@bp.route("/history/delete", methods=["DELETE"])
async def delete_conversation():
    await cosmos_db_ready.wait()
    ## get the user id from the request headers
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    try:
        if not conversation_id:
            return jsonify({"error": "conversation_id is required"}), 400

        ## make sure cosmos is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        ## delete the conversation messages from cosmos first
        deleted_messages = await current_app.cosmos_conversation_client.delete_messages(
            conversation_id, user_id
        )

        ## Now delete the conversation
        deleted_conversation = await current_app.cosmos_conversation_client.delete_conversation(
            user_id, conversation_id
        )

        return (
            jsonify(
                {
                    "message": "Successfully deleted conversation and messages",
                    "conversation_id": conversation_id,
                }
            ),
            200,
        )
    except Exception as e:
        logging.exception("Exception in /history/delete")
        return jsonify({"error": str(e)}), 500


@bp.route("/history/list", methods=["GET"])
async def list_conversations():
    await cosmos_db_ready.wait()
    offset = request.args.get("offset", 0)
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## make sure cosmos is configured
    if not current_app.cosmos_conversation_client:
        raise Exception("CosmosDB is not configured or not working")

    ## get the conversations from cosmos
    conversations = await current_app.cosmos_conversation_client.get_conversations(
        user_id, offset=offset, limit=25
    )
    if not isinstance(conversations, list):
        return jsonify({"error": f"No conversations for {user_id} were found"}), 404

    ## return the conversation ids

    return jsonify(conversations), 200


@bp.route("/history/read", methods=["POST"])
async def get_conversation():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    if not conversation_id:
        return jsonify({"error": "conversation_id is required"}), 400

    ## make sure cosmos is configured
    if not current_app.cosmos_conversation_client:
        raise Exception("CosmosDB is not configured or not working")

    ## get the conversation object and the related messages from cosmos
    conversation = await current_app.cosmos_conversation_client.get_conversation(
        user_id, conversation_id
    )
    ## return the conversation id and the messages in the bot frontend format
    if not conversation:
        return (
            jsonify(
                {
                    "error": f"Conversation {conversation_id} was not found. It either does not exist or the logged in user does not have access to it."
                }
            ),
            404,
        )

    # get the messages for the conversation from cosmos
    conversation_messages = await current_app.cosmos_conversation_client.get_messages(
        user_id, conversation_id
    )

    ## format the messages in the bot frontend format
    messages = [
        {
            "id": msg["id"],
            "role": msg["role"],
            "content": msg["content"],
            "createdAt": msg["createdAt"],
            "feedback": msg.get("feedback"),
        }
        for msg in conversation_messages
    ]

    return jsonify({"conversation_id": conversation_id, "messages": messages}), 200


@bp.route("/history/rename", methods=["POST"])
async def rename_conversation():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    if not conversation_id:
        return jsonify({"error": "conversation_id is required"}), 400

    ## make sure cosmos is configured
    if not current_app.cosmos_conversation_client:
        raise Exception("CosmosDB is not configured or not working")

    ## get the conversation from cosmos
    conversation = await current_app.cosmos_conversation_client.get_conversation(
        user_id, conversation_id
    )
    if not conversation:
        return (
            jsonify(
                {
                    "error": f"Conversation {conversation_id} was not found. It either does not exist or the logged in user does not have access to it."
                }
            ),
            404,
        )

    ## update the title
    title = request_json.get("title", None)
    if not title:
        return jsonify({"error": "title is required"}), 400
    conversation["title"] = title
    updated_conversation = await current_app.cosmos_conversation_client.upsert_conversation(
        conversation
    )

    return jsonify(updated_conversation), 200


@bp.route("/history/delete_all", methods=["DELETE"])
async def delete_all_conversations():
    await cosmos_db_ready.wait()
    ## get the user id from the request headers
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    # get conversations for user
    try:
        ## make sure cosmos is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        conversations = await current_app.cosmos_conversation_client.get_conversations(
            user_id, offset=0, limit=None
        )
        if not conversations:
            return jsonify({"error": f"No conversations for {user_id} were found"}), 404

        # delete each conversation
        for conversation in conversations:
            ## delete the conversation messages from cosmos first
            deleted_messages = await current_app.cosmos_conversation_client.delete_messages(
                conversation["id"], user_id
            )

            ## Now delete the conversation
            deleted_conversation = await current_app.cosmos_conversation_client.delete_conversation(
                user_id, conversation["id"]
            )
        return (
            jsonify(
                {
                    "message": f"Successfully deleted conversation and messages for user {user_id}"
                }
            ),
            200,
        )

    except Exception as e:
        logging.exception("Exception in /history/delete_all")
        return jsonify({"error": str(e)}), 500


@bp.route("/history/clear", methods=["POST"])
async def clear_messages():
    await cosmos_db_ready.wait()
    ## get the user id from the request headers
    authenticated_user = get_authenticated_user_details(request_headers=request.headers)
    user_id = authenticated_user["user_principal_id"]

    ## check request for conversation_id
    request_json = await request.get_json()
    conversation_id = request_json.get("conversation_id", None)

    try:
        if not conversation_id:
            return jsonify({"error": "conversation_id is required"}), 400

        ## make sure cosmos is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        ## delete the conversation messages from cosmos
        deleted_messages = await current_app.cosmos_conversation_client.delete_messages(
            conversation_id, user_id
        )

        return (
            jsonify(
                {
                    "message": "Successfully deleted messages in conversation",
                    "conversation_id": conversation_id,
                }
            ),
            200,
        )
    except Exception as e:
        logging.exception("Exception in /history/clear_messages")
        return jsonify({"error": str(e)}), 500


@bp.route("/history/ensure", methods=["GET"])
async def ensure_cosmos():
    await cosmos_db_ready.wait()
    if not app_settings.chat_history:
        return jsonify({"error": "CosmosDB is not configured"}), 404

    try:
        success, err = await current_app.cosmos_conversation_client.ensure()
        if not current_app.cosmos_conversation_client or not success:
            if err:
                return jsonify({"error": err}), 422
            return jsonify({"error": "CosmosDB is not configured or not working"}), 500

        return jsonify({"message": "CosmosDB is configured and working"}), 200
    except Exception as e:
        logging.exception("Exception in /history/ensure")
        cosmos_exception = str(e)
        if "Invalid credentials" in cosmos_exception:
            return jsonify({"error": cosmos_exception}), 401
        elif "Invalid CosmosDB database name" in cosmos_exception:
            return (
                jsonify(
                    {
                        "error": f"{cosmos_exception} {app_settings.chat_history.database} for account {app_settings.chat_history.account}"
                    }
                ),
                422,
            )
        elif "Invalid CosmosDB container name" in cosmos_exception:
            return (
                jsonify(
                    {
                        "error": f"{cosmos_exception}: {app_settings.chat_history.conversations_container}"
                    }
                ),
                422,
            )
        else:
            return jsonify({"error": "CosmosDB is not working"}), 500


async def generate_title(conversation_messages) -> str:
    ## make sure the messages are sorted by _ts descending
    title_prompt = "Summarize the conversation so far into a 4-word or less title. Do not use any quotation marks or punctuation. Do not include any other commentary or description."

    messages = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in conversation_messages
    ]
    messages.append({"role": "user", "content": title_prompt})

    try:
        azure_openai_client = await init_openai_client()
        response = await azure_openai_client.chat.completions.create(
            model=app_settings.azure_openai.model, messages=messages, temperature=1, max_tokens=64
        )

        title = response.choices[0].message.content
        return title
    except Exception as e:
        logging.exception("Exception while generating title", e)
        return messages[-2]["content"]


# Function to generate embeddings using OpenAI API
# def generate_embeddings(content):
#     url = f"{openai_api_base}openai/deployments/{embedding_deployment}/embeddings?api-version={openai_api_version}"
#     headers = {
#         "Content-Type": "application/json",
#         "api-key": openai_api_key,
#     }
#     data = {
#         "input": content,
#     }
#     response = requests.post(url, headers=headers, json=data)
#     response.raise_for_status()
#     return response.json().get("data", [])[0].get("embedding", [])


# Function to upload a PDF to Blob Storage
def upload_to_blob_storage(blob_client, file_data):
    blob_client.upload_blob(file_data, overwrite=True)
    
    
@bp.route("/pipeline/list", methods=["GET"])
async def list_files():
    # Get the company name from the query parameter (if provided)
    company_name = request.args.get("company", "").strip().lower().strip('.')
    container_client = blob_service_client.get_container_client(container=container_name)
    
    if company_name:
        # Filter blob names that start with the company name followed by '/'
        blob_list = [blob.name for blob in container_client.list_blobs() if blob.name.startswith(f"{company_name}/")]
    else:
        # Fallback: return all files if no company name is provided
        blob_list = [blob.name for blob in container_client.list_blobs()]
    
    return {"files": blob_list}

# Define a function to extract keyphrases using RAKE
# def extract_keyphrases(content):
#     rake.extract_keywords_from_text(content)
#     return rake.get_ranked_phrases()

# Modify your existing endpoint
@bp.route("/pipeline/upload", methods=["POST"])
async def upload_files():
    # Await the form and files to retrieve their data
    form = await request.form
    files = (await request.files).getlist("files")

    # print(files)

    # Retrieve the 'organization' field from the form data
    organization = form.get("organization")
    print("organization:",organization)

    processed_files = []
    skipped_files = []

    # Normalize the organization name to lowercase and trim spaces
    organization_folder = organization.strip().lower().strip('.')

    for uploaded_file in files:
        print(f"uploaded_file {uploaded_file}")
        file_name = uploaded_file.filename
        # Create the path for the file inside the folder based on organization
        blob_path = f"{organization_folder}/{file_name}"  # folder_name/file_name

        blob_client = blob_service_client.get_blob_client(
            container=container_name, blob=blob_path
        )

        # Check if the file already exists in the blob container
        if blob_client.exists():
            skipped_files.append(file_name)
            continue

        # Create a NamedTemporaryFile with delete=False
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        temp_file_path = temp_file.name

        try:
            # Write the uploaded file's bytes to the temp file
            await uploaded_file.save(temp_file_path)

            if os.path.getsize(temp_file_path) == 0:
                return jsonify({"detail": f"Uploaded file {file_name} is empty."}), 400

            # Process the file with LlamaMarkdownReader
            try:
                llama_docs = pymupdf4llm.LlamaMarkdownReader().load_data(temp_file_path)
            except Exception as e:
                return jsonify({"detail": f"Failed to process file {file_name}: {str(e)}"}), 500

            # Build doc array and upload to Azure Cognitive Search
            docs_array = []
            for doc in llama_docs:
                doc_dict = doc.dict()
                metadata = doc_dict.get("metadata", {})
                page = metadata.get("page")
                total_pages = metadata.get("total_pages")
                title_with_pages = f"Page {page} of {total_pages}"
                content = doc_dict.get("text", "")

                # Extract keyphrases using RAKE
                # keywords = extract_keyphrases(content)

                # content_vector = generate_embeddings(content)
                # Generate embedding using SentenceTransformer instead of OpenAI's API
                content_vector = model.encode(content).tolist()

                transformed_doc = {
                    "id": doc_dict.get("id_"),
                    "organization": organization,
                    "title": title_with_pages,
                    "page": page,
                    "total_pages": total_pages,
                    "file": file_name,
                    "content": content,
                    "contentVector": content_vector,
                    "keywords": [],
                }
                docs_array.append(transformed_doc)

            try:
                search_client.upload_documents(docs_array)
            except Exception as e:
                return jsonify({"detail": f"Indexing failed for {file_name}: {str(e)}"}), 500

            # Upload the file to Blob Storage inside the folder
            with open(temp_file_path, "rb") as f:
                pdf_data = f.read()
            blob_client.upload_blob(pdf_data, overwrite=True)

            processed_files.append(file_name)

        finally:
            # Retry loop to safely remove the temp file on Windows
            for i in range(5):
                try:
                    if os.path.exists(temp_file_path):
                        os.remove(temp_file_path)
                    break
                except PermissionError:
                    time.sleep(0.5)

    return jsonify({
        "processed_files": processed_files,
        "skipped_files": skipped_files
    })  
    
# Route to delete all files or files by companyClaim or organizationFilter
@bp.route("/pipeline/delete_all", methods=["DELETE"])
async def delete_all():
    form = await request.form  # Await the form coroutine to get the form data
    organizationFilter = form.get("organizationFilter")
    companyClaim = form.get("companyClaim")

    container_client = blob_service_client.get_container_client(container=container_name)
    blob_list = list(container_client.list_blobs())

    files_to_delete = []
    if companyClaim:
        files_to_delete = [blob.name for blob in blob_list if blob.name.startswith(f"{companyClaim.strip().lower().strip('.')}/")]
    else:
        if organizationFilter == "all":
            files_to_delete = [blob.name for blob in blob_list]
        else:
            files_to_delete = [blob.name for blob in blob_list if blob.name.startswith(f"{organizationFilter.strip().lower().strip('.')}/")]

    for file in files_to_delete:
        container_client.delete_blob(file)

    results = search_client.search(search_text="*")
    keys_to_delete = []

    for doc in results:
        if companyClaim:
            if doc.get("organization") == companyClaim.strip().lower().strip('.'):
                keys_to_delete.append(doc["id"])
        else:
            if organizationFilter == "all" or doc.get("organization") == organizationFilter.strip().lower().strip('.'):
                keys_to_delete.append(doc["id"])

    if keys_to_delete:
        batch = [{"@search.action": "delete", "id": key} for key in keys_to_delete]
        search_client.upload_documents(documents=batch)

    return jsonify({
        "message": f"Deleted {len(files_to_delete)} files and {len(keys_to_delete)} documents based on the filter criteria."
    })

# Route to delete a specific file
@bp.route("/pipeline/delete_file/<path:filename>", methods=["DELETE"])
async def delete_single_file(filename):
    container_client = blob_service_client.get_container_client(container=container_name)
    blob_client = container_client.get_blob_client(filename)

    if blob_client.exists():
        blob_client.delete_blob()
    else:
        return jsonify({"message": f"The file '{filename}' was not found in the blob container."}), 404

    results = search_client.search(search_text="*")
    keys_to_delete = []
    for doc in results:
        if doc.get("file") == os.path.basename(filename):
            folder_name = filename.split("/")[0]
            if doc.get("organization") == folder_name:
                keys_to_delete.append(doc["id"])

    if keys_to_delete:
        batch = [{"@search.action": "delete", "id": key} for key in keys_to_delete]
        search_client.upload_documents(documents=batch)
        return jsonify({"message": f"File '{filename}' and all related documents have been deleted."})
    else:
        return jsonify({"message": f"File '{filename}' was deleted from blob storage, but no matching documents were found in the index."})

@bp.route("/history_data", methods=["GET"])
async def table_data():
    # Get the authenticated user details
    authenticated_user = get_authenticated_user_details(request.headers)
    user_id = authenticated_user["user_principal_id"]

    if not current_app.cosmos_conversation_client:
        return jsonify({"error": "CosmosDB is not configured or not working"}), 500

    # Get a list of conversations for this user (adjust offset/limit as needed)
    conversations = await current_app.cosmos_conversation_client.get_conversations(user_id, offset=0, limit=100)
    table_rows = []

    for conv in conversations:
        conversation_id = conv["id"]

        # Get messages for each conversation
        conversation_messages = await current_app.cosmos_conversation_client.get_messages(user_id, conversation_id)

        # Initialize empty fields
        system_message = None
        user_prompt = ""
        assistant_answer = ""
        timestamp = ""
        citations = []  # New field for citations

        # Query CosmosDB for the system message from the 'system_messages' collection
        try:
            database = cosmos_client.get_database_client(app_settings.chat_history.database)
            container = database.get_container_client("system_messages")  # Use the correct collection name

            query = f"SELECT * FROM c WHERE c.conversation_id = '{conversation_id}'"
            results = list(container.query_items(query=query, enable_cross_partition_query=True))

            if results:
                system_message = results[0].get("system_message", app_settings.azure_openai.system_message)
            else:
                system_message = app_settings.azure_openai.system_message  # Fallback to default
        except Exception as e:
            logging.error(f"Error retrieving system message for conversation {conversation_id}: {e}")
            system_message = app_settings.azure_openai.system_message  # Fallback to default if error occurs

        # Iterate over messages to capture the first user prompt and assistant answer.
        # If the message immediately preceding the assistant message is a tool message,
        # attempt to parse it for citations.
        for i, msg in enumerate(conversation_messages):
            role = msg.get("role", "")
            if role == "user" and not user_prompt:
                user_prompt = msg.get("content", "")
            elif role == "assistant" and not assistant_answer:
                assistant_answer = msg.get("content", "")
                timestamp = msg.get("createdAt", "")
                if i > 0:
                    previous_msg = conversation_messages[i - 1]
                    if previous_msg.get("role") == "tool":
                        try:
                            tool_msg = json.loads(previous_msg.get("content", "{}"))
                            citations = tool_msg.get("citations", [])
                        except Exception as e:
                            logging.error(f"Error parsing citations for conversation {conversation_id}: {e}")
            # Stop once both a user prompt and an assistant answer are found.
            if user_prompt and assistant_answer:
                break

        # Only add rows that have both a user prompt and an assistant answer.
        if user_prompt and assistant_answer:
            table_rows.append({
                "timestamp": timestamp,
                "system_message": system_message,
                "user_prompt": user_prompt,
                "assistant_answer": assistant_answer,
                "citations": citations  # Include citations in the response
            })

    return jsonify(table_rows), 200

# Fetch System Message
@bp.route("/system_message", methods=["GET"])
async def get_system_message():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request.headers)
    user_id = authenticated_user["user_principal_id"]

    try:
        # Make sure CosmosDB is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        # Get the CosmosDB container
        container = cosmos_client.get_database_client(app_settings.chat_history.database).get_container_client(USER_SYSTEM_MESSAGE_COLLECTION)

        # Check if the user already has a system message in the collection
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))

        # If no entry exists, return the default system message from settings
        if not results:
            return jsonify({"system_message": app_settings.azure_openai.system_message}), 200

        # If an entry exists, return the stored system message
        system_message_entry = results[0]
        return jsonify({"system_message": system_message_entry["system_message"]}), 200

    except Exception as e:
        logging.exception("Error fetching system message")
        return jsonify({"error": str(e)}), 500


# Update System Message
@bp.route("/system_message", methods=["POST"])
async def update_system_message():
    await cosmos_db_ready.wait()
    authenticated_user = get_authenticated_user_details(request.headers)
    user_id = authenticated_user["user_principal_id"]

    request_json = await request.get_json()
    new_system_message = request_json.get("system_message")

    if not new_system_message:
        return jsonify({"error": "system_message is required"}), 400

    try:
        # Make sure CosmosDB is configured
        if not current_app.cosmos_conversation_client:
            raise Exception("CosmosDB is not configured or not working")

        # Get the CosmosDB container
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        container = database.get_container_client(USER_SYSTEM_MESSAGE_COLLECTION)

        # Check if the collection exists, if not create it
        existing_collections = [coll['id'] for coll in database.list_containers()]
        if USER_SYSTEM_MESSAGE_COLLECTION not in existing_collections:
            container = database.create_container(id=USER_SYSTEM_MESSAGE_COLLECTION, partition_key=PartitionKey(path='/user_id'))
            print(f"Created collection '{USER_SYSTEM_MESSAGE_COLLECTION}'.")

        # Query for the system message
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))

        if results:
            # Update the system message for the existing entry
            system_message_entry = results[0]
            system_message_entry["system_message"] = new_system_message
            container.upsert_item(system_message_entry)
        else:
            # Insert a new system message for the user, ensuring to include the 'id'
            container.create_item({
                "id": str(uuid.uuid4()),  # Generate a unique id for the system message
                "user_id": user_id,
                "system_message": new_system_message
            })

        return jsonify({"message": "System message updated successfully"}), 200

    except Exception as e:
        logging.exception("Error updating system message")
        return jsonify({"error": str(e)}), 500

@bp.route("/embed", methods=["POST"])
async def embed_text():
    try:
        request_json = await request.get_json()
        text = request_json.get("input", "")
        if not text:
            return jsonify({"error": "Error: 'input' field is empty."}), 400

        logging.info("Quart endpoint for text embedding has been called.")

        try:
            embedding = model.encode(text)
        except Exception as e:
            logging.exception("Error generating embedding")
            return jsonify({"error": f"Error generating embedding: {str(e)}"}), 500

        # Convert embedding to a list if necessary for JSON serialization
        embedding_list = embedding.tolist() if hasattr(embedding, "tolist") else embedding

        response_data = {
            "data": [
                {
                    "embedding": embedding_list
                }
            ]
        }
        return jsonify(response_data), 200

    except Exception as e:
        logging.exception("Exception in /embed endpoint")
        return jsonify({"error": str(e)}), 500


app = create_app()
