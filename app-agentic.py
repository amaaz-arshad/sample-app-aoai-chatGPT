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
    Response
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
import fitz 
import time
from azure.cosmos import CosmosClient, PartitionKey
import xml.etree.ElementTree as ET
from typing import List
from io import BytesIO
import gc
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
from collections import deque
from datetime import datetime
# Add these imports at the top of app.py
from queue import Queue
from threading import Thread, Event
import queue
from azure.identity.aio import ClientSecretCredential  # async version
# Add to existing imports
import tiktoken
from typing import List, Dict
import random
from azure.search.documents.knowledgebases import KnowledgeBaseRetrievalClient
from azure.search.documents.knowledgebases.models import (
    KnowledgeBaseRetrievalRequest,
    KnowledgeBaseMessage,
    KnowledgeBaseMessageTextContent,
    SearchIndexKnowledgeSourceParams,
)
from azure.search.documents.indexes.models import KnowledgeRetrievalMediumReasoningEffort

# Add pricing constants (GPT-4o pricing as of 2024)
GPT4O_INPUT_PRICE_PER_1K_TOKENS = 0.0025  # $2.50 per 1M tokens
GPT4O_OUTPUT_PRICE_PER_1K_TOKENS = 0.01  # $10.00 per 1M tokens

# Collection name for estimated costs
ESTIMATED_COSTS_COLLECTION = "estimated_costs"

load_dotenv() 

print(f"model: {app_settings.azure_openai.embedding_name}")
# model = SentenceTransformer(os.getenv("AZURE_OPENAI_EMBEDDING_NAME"))
cosmos_account_uri = f"https://{app_settings.chat_history.account}.documents.azure.com:443/"

cosmos_client = CosmosClient(cosmos_account_uri, credential=os.getenv("REACT_APP_AZURE_COSMOS_ACCOUNT_KEY"))
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
blob_service_url = os.getenv("REACT_APP_AZURE_BLOB_URL")
# container_name = "pdf-container2"
container_name = os.getenv("REACT_APP_AZURE_BLOB_CONTAINER_NAME")
storage_key = os.getenv("REACT_APP_AZURE_BLOB_STORAGE_KEY")
blob_service_client = BlobServiceClient(account_url=blob_service_url, credential=storage_key)

# Create a SearchClient instance
search_client = SearchClient(service_endpoint, index_name, AzureKeyCredential(api_key))

# --- NEW: Agentic retrieval knowledge base configuration ---
# These should be set in your environment or config.
KNOWLEDGE_BASE_NAME = os.getenv("AZURE_SEARCH_KB_NAME")
KNOWLEDGE_SOURCE_NAME = os.getenv("AZURE_SEARCH_KS_NAME")

if not KNOWLEDGE_BASE_NAME or not KNOWLEDGE_SOURCE_NAME:
    logging.warning(
        "AZURE_SEARCH_KB_NAME or AZURE_SEARCH_KS_NAME not set. "
        "Agentic retrieval will not work until these are configured."
    )

knowledge_base_client = None
if KNOWLEDGE_BASE_NAME:
    knowledge_base_client = KnowledgeBaseRetrievalClient(
        endpoint=service_endpoint,
        knowledge_base_name=KNOWLEDGE_BASE_NAME,
        credential=AzureKeyCredential(api_key),
    )


bp = Blueprint("routes", __name__, static_folder="static", template_folder="static")

cosmos_db_ready = asyncio.Event()

MAX_WORKERS = int(os.getenv("THREAD_POOL_MAX_WORKERS", "3"))

# Initialize a thread pool for CPU-bound tasks
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

# Replace the current upload_jobs and job_lock with a more comprehensive system
upload_queue = Queue()
queue_worker_running = Event()
upload_jobs = {}
job_lock = threading.Lock()
JOB_EXPIRY_SECONDS = 86400  # 24 hours

# Add these constants near the top with other settings
MAX_QUEUE_WORKERS = 1  # Process one batch at a time
JOB_QUEUE_MAX_SIZE = 100  # Maximum jobs in queue

conversation_context_cache = {}

# Queue worker function
def queue_worker():
    while queue_worker_running.is_set():
        try:
            # Get a job from the queue (wait up to 1 second)
            job_data = upload_queue.get(timeout=1)
            job_id, file_data, is_xml = job_data
            
            # Update job status to processing
            update_job_status(job_id, "processing")
            
            # Process the files
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                if is_xml:
                    result = loop.run_until_complete(async_process_files(file_data, job_id, True))
                else:
                    result = loop.run_until_complete(async_process_files(file_data, job_id, False))
                
                loop.close()
                
                # Mark job as completed
                update_job_status(job_id, "completed", result=result)
                
            except Exception as e:
                logging.error(f"Job {job_id} failed: {str(e)}")
                update_job_status(job_id, "failed", error=str(e))
                
            finally:
                upload_queue.task_done()
                
        except queue.Empty:
            # No jobs in queue, continue waiting
            continue

# Start the queue worker when the app starts
def start_queue_workers():
    queue_worker_running.set()
    for i in range(MAX_QUEUE_WORKERS):
        worker = Thread(target=queue_worker, daemon=True)
        worker.start()

# Stop the queue worker when the app shuts down
def stop_queue_workers():
    queue_worker_running.clear()

# Update the update_job_status function to handle queue positions
def update_job_status(job_id: str, status: str, result: dict = None, error: str = None):
    with job_lock:
        # If the job is completing, remove queue position info
        if status in ["processing", "completed", "failed"] and result and "position_in_queue" in result:
            del result["position_in_queue"]
            
        upload_jobs[job_id] = {
            "status": status,
            "result": result,
            "error": error,
            "timestamp": datetime.utcnow().isoformat()
        }

def cleanup_expired_jobs():
    while True:
        time.sleep(3600)  # Cleanup hourly
        with job_lock:
            now = datetime.utcnow()
            expired_keys = [
                job_id for job_id, job in upload_jobs.items()
                if (now - datetime.fromisoformat(job["timestamp"])).total_seconds() > JOB_EXPIRY_SECONDS
            ]
            for job_id in expired_keys:
                del upload_jobs[job_id]

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_expired_jobs, daemon=True)
cleanup_thread.start()

# Helper to run async in background thread
def run_async_in_thread(loop, coro):
    asyncio.set_event_loop(loop)
    loop.run_until_complete(coro)
    
# Modify the create_app function to start queue workers
def create_app():
    app = Quart(__name__)
    app.register_blueprint(bp)
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    # Allow files up to 100000MB
    app.config["MAX_CONTENT_LENGTH"] = 100000 * 1024 * 1024
    
    @app.before_serving
    async def init():
        try:
            app.cosmos_conversation_client = await init_cosmosdb_client()
            cosmos_db_ready.set()
            # Start queue workers when app starts
            start_queue_workers()
        except Exception as e:
            logging.exception("Failed to initialize CosmosDB client")
            app.cosmos_conversation_client = None
            raise e
    
    # Add shutdown handler
    @app.after_serving
    async def shutdown():
        stop_queue_workers()
    
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

async def build_messages_and_metadata(request_body, request_headers):
    """
    Build the OpenAI-style messages array + system_message + user_json + companyName,
    reusing the existing CosmosDB system-message logic.
    """
    request_messages = request_body.get("messages", [])
    messages = []

    # Extract the bearer token from the Authorization header (unchanged)
    auth_header = request_headers.get("Authorization")
    bearer_token = auth_header.split("Bearer ")[1] if auth_header and auth_header.startswith("Bearer ") else None

    # Retrieve the system message from Cosmos DB for the authenticated user
    authenticated_user = get_authenticated_user_details(request_headers)
    user_id = authenticated_user["user_principal_id"]
    system_message = app_settings.azure_openai.system_message

    try:
        # Get the CosmosDB container for system messages
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        container = database.get_container_client(USER_SYSTEM_MESSAGE_COLLECTION)

        # Query for the system message for the authenticated user
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))

        if results:
            system_message = results[0]["system_message"]
    except Exception as e:
        logging.error(f"Error retrieving system message for user {user_id}: {e}")

    # Always prepend system message (this preserves and actually strengthens your existing behavior)
    messages = [
        {
            "role": "system",
            "content": system_message
        }
    ]

    # Now add the conversation messages from the request
    for message in request_messages:
        if not message:
            continue
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
        user_json = get_msdefender_user_json(
            authenticated_user_details, request_headers, conversation_id, application_name
        )

    # Get organization context from body for filtering
    companyName = request_body.get("companyName", "").strip()

    # For debugging if needed:
    # print(f"System message used: {system_message}")
    print(f"Final messages array: {messages}")

    return messages, system_message, user_json, companyName


async def prepare_model_args(request_body, request_headers):
    messages, system_message, user_json, companyName = await build_messages_and_metadata(
        request_body, request_headers
    )

    model_args = {
        "messages": messages,
        "temperature": app_settings.azure_openai.temperature,
        "max_tokens": app_settings.azure_openai.max_tokens,
        "top_p": app_settings.azure_openai.top_p,
        "stop": app_settings.azure_openai.stop_sequence,
        "stream": app_settings.azure_openai.stream,
        "model": app_settings.azure_openai.model,
        "user": user_json,
    }

    # No more basic RAG via extra_body / data_sources.
    # All retrieval will be handled via agentic retrieval (KnowledgeBaseRetrievalClient).

    model_args_clean = copy.deepcopy(model_args)
    logging.debug(f"REQUEST BODY (no RAG extra_body): {json.dumps(model_args_clean, indent=4)}")

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

async def agentic_retrieval_chat(request_body, request_headers):
    """
    Use Azure AI Search Knowledge Base (agentic retrieval) instead of basic RAG.
    - Uses the same messages constructed from CosmosDB system message and chat history.
    - Applies companyName filter via filter_add_on on the search index knowledge source.
    - Returns a simple assistant message object consumable by the frontend.
    """
    if knowledge_base_client is None:
        raise RuntimeError("Knowledge base client is not configured. Set AZURE_SEARCH_KB_NAME / KS_NAME.")

    messages, system_message, user_json, companyName = await build_messages_and_metadata(
        request_body, request_headers
    )

    # Build KB messages, skipping 'system' role because KB system behavior is configured in the KB itself.
    kb_messages = [
        KnowledgeBaseMessage(
            role=m["role"],
            content=[KnowledgeBaseMessageTextContent(text=m["content"])]
        )
        for m in messages
        if m.get("role") != "system"
    ]

    # Build filter_add_on from companyName (organization filter)
    filter_add_on = None
    if companyName:
        # Normalize and escape for OData
        company_normalized = companyName.strip().lower().strip(".")
        from_odata = _escape_odata_string(company_normalized)
        filter_add_on = f"organization eq '{from_odata}'"

    # Knowledge source params (search index KS)
    ks_params_kwargs = {
        "knowledge_source_name": KNOWLEDGE_SOURCE_NAME,
        "include_references": True,
        "include_reference_source_data": True,
        "always_query_source": True,
    }
    if filter_add_on:
        ks_params_kwargs["filter_add_on"] = filter_add_on

    ks_params = SearchIndexKnowledgeSourceParams(**ks_params_kwargs)

    # Build retrieval request
    req = KnowledgeBaseRetrievalRequest(
        messages=kb_messages,
        knowledge_source_params=[ks_params],
        include_activity=True,
        retrieval_reasoning_effort=KnowledgeRetrievalMediumReasoningEffort,
        # You can set output_mode here if needed; default is whatever the KB is configured for.
        # output_mode=
    )

    # Run retrieval in a thread to avoid blocking the event loop
    def _do_retrieve():
        return knowledge_base_client.retrieve(retrieval_request=req)

    result = await asyncio.to_thread(_do_retrieve)

    # --- Extract answer text ---
    answer_text = ""
    try:
        if getattr(result, "response", None):
            first_response = result.response[0]
            contents = getattr(first_response, "content", None) or []
            if contents:
                answer_text = getattr(contents[0], "text", "") or ""
    except Exception as e:
        logging.error(f"Error extracting answer text: {e}")
        answer_text = ""

    # --- Extract raw references from KB ---
    references = []
    try:
        refs = getattr(result, "references", None) or []
        for ref in refs:
            source_data = getattr(ref, "source_data", None) or getattr(ref, "sourceData", None)
            if source_data:
                references.append(source_data)
    except Exception as e:
        logging.error(f"Error extracting references: {e}")

    # --- Convert KB references to your UI's Citation format ---
    citations = []
    for ref in references:
        citations.append({
            "id": str(uuid.uuid4()),
            "title": ref.get("title", ""),
            "content": ref.get("content", ""),
            "filepath": ref.get("filepath") or ref.get("url") or "",
            "url": ref.get("url", ""),
            "chunk_id": ref.get("chunk_id", "0"),
        })

    # --- Prepare history_metadata (required by frontend) ---
    req_history = request_body.get("history_metadata")
    conversation_id = request_body.get("conversation_id")

    if req_history:
        # Continue an existing conversation
        history_metadata = req_history
    else:
        # New conversation
        # Generate title from user’s last message
        last_user_msg = None
        for m in reversed(messages):
            if m["role"] == "user":
                last_user_msg = m["content"]
                break

        history_metadata = {
            "conversation_id": conversation_id or str(uuid.uuid4()),
            "title": (last_user_msg[:50] + "...") if isinstance(last_user_msg, str) else "New Chat",
            "date": datetime.utcnow().isoformat(),
        }
    
    # --- Build ChatResponse identical to AOAI-on-your-data ---
    chat_response = {
        "id": str(uuid.uuid4()),
        "choices": [{
            "messages": [
                {
                    "role": "tool",
                    "content": json.dumps({
                        "citations": citations,
                        "data_points": citations,
                    }),
                },
                {
                    "role": "assistant",
                    "content": answer_text,
                },
            ]
        }],
        "history_metadata": history_metadata,
    }

    return chat_response


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
    conversation_id = request_body.get("conversation_id")
    
    # Get authenticated user for cost tracking
    authenticated_user = get_authenticated_user_details(request_headers)
    user_question = ""
    
    # Extract user question from request messages
    messages = request_body.get("messages", [])
    for message in reversed(messages):
        if message.get("role") == "user":
            user_question = message.get("content", "")
            break
    
    # For streaming, we need to collect the complete response
    full_assistant_response = ""
    
    async def generate():
        nonlocal full_assistant_response
        async for completionChunk in response:
            # Extract content from the chunk
            if completionChunk.choices and completionChunk.choices[0].delta.content:
                content = completionChunk.choices[0].delta.content
                full_assistant_response += content
            
            yield format_stream_response(completionChunk, history_metadata, apim_request_id)
        
        # After streaming is complete, update costs in background
        if user_question and full_assistant_response:
            # Use asyncio.create_task to run in background without blocking
            asyncio.create_task(
                update_estimated_costs(authenticated_user, user_question, full_assistant_response, conversation_id)
            )

    return generate()


async def conversation_internal(request_body, request_headers):
    try:
        # If a datasource is configured, we now interpret that as:
        # "use agentic retrieval (knowledge base) instead of basic AOAI-on-your-data RAG"
        if app_settings.datasource and not app_settings.base_settings.use_promptflow:
            # We do NOT stream here; KnowledgeBaseRetrievalClient.retrieve is non-streaming.
            assistant_message = await agentic_retrieval_chat(request_body, request_headers)
            return jsonify(assistant_message)

        # No datasource -> normal AOAI chat (existing behavior)
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
    title_prompt = "Summarize the conversation so far into a 4-word or less title in german language. Do not use any quotation marks or punctuation. Do not include any other commentary or description."

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
def generate_embeddings(content):
    url = f"{openai_api_base}openai/deployments/{embedding_deployment}/embeddings?api-version={openai_api_version}"
    headers = {
        "Content-Type": "application/json",
        "api-key": openai_api_key,
    }
    data = {
        "input": content,
    }
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json().get("data", [])[0].get("embedding", [])


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


# Helper function to extract pages from PDF bytes
async def extract_pages_as_markdown(pdf_bytes: bytes, file_name: str) -> list:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, 
        lambda: _extract_pages_sync(pdf_bytes, file_name)
    )

def _extract_pages_sync(pdf_bytes: bytes, file_name: str) -> list:
    """Synchronous PDF processing"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = doc.page_count
    pages = []
    for page in doc:
        text = page.get_text("text")
        md = f"## {file_name} - Page {page.number + 1}\n\n{text}\n"
        pages.append({
            "page_number": page.number + 1,
            "markdown": md,
            "total_pages": total_pages
        })
    return pages

async def process_single_file(filename: str, content: bytes, organization: str):
    blob_path = f"{organization}/{filename}"
    blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
    
    if blob_client.exists():
        return None, filename  # Skip existing
    
    try:
        print(f"Processing file: {filename}")
        # Extract pages from PDF
        page_data = await extract_pages_as_markdown(content, filename)
        
        docs_array = []
        loop = asyncio.get_running_loop()
        
        # Process each page individually (no broken batching)
        for p in page_data:
            # Generate embedding for this page in thread pool
            vector = await loop.run_in_executor(
                executor,
                lambda text=p["markdown"]: generate_embeddings(text)
            )
            
            docs_array.append({
                "id": str(uuid.uuid4()),
                "chunk_id": str(p["page_number"]),  # stored as string
                "parent_id": "",
                "organization": organization,
                "title": f"Page {p['page_number']}",
                "page_number": p["page_number"],
                "total_pages": p["total_pages"],
                "file": filename,
                "url": "",
                "content": p["markdown"],
                "contentVector": vector,  # full vector (list[float]), not a single float
                "category": [],
                "tags": []
            })
        
        # Upload documents in batches of 5
        for i in range(0, len(docs_array), 5):
            batch = docs_array[i:i+5]
            search_client.upload_documents(batch)
            await asyncio.sleep(0.5)  # Throttle requests
        
        # Upload to blob storage
        blob_client.upload_blob(content)
        return filename, None
    
    except Exception as e:
        logging.error(f"Failed {filename}: {str(e)}")
        return None, filename
    finally:
        # Explicit memory cleanup
        del content
        gc.collect()


# Modify the upload endpoints to use the queue
@bp.route("/pipeline/upload", methods=["POST"])
async def upload_files():
    form = await request.form
    files = (await request.files).getlist("files")
    organization = form.get("organization", "").strip().lower().strip('.')
    user_type = form.get("user_type", "").strip().lower()  # Get user type from frontend

    if not organization:
        return jsonify({"detail": "Missing 'organization' field."}), 400

    # Helper to run synchronous search in a thread
    def collect_pdf_files_from_search(filter_expr: str):
        """Run the synchronous azure search and return {filename: total_pages}."""
        # Use a different approach - get unique files and their page counts
        results = search_client.search(
            search_text="*",
            filter=filter_expr,
            select="file, total_pages",
            include_total_count=True
        )
        
        pdf_files_local = {}
        processed_files = set()
        
        for result in results:
            filename = result.get("file")
            
            if not filename or filename in processed_files:
                continue
                
            # For PDF files, we should have total_pages field
            total_pages = result.get("total_pages")
            if total_pages is not None:
                try:
                    pdf_files_local[filename] = int(total_pages)
                    processed_files.add(filename)
                except (ValueError, TypeError):
                    pdf_files_local[filename] = 0
                    processed_files.add(filename)
                    
        return pdf_files_local

    # Check page limit for free users
    if user_type == "free-user":
        escaped = _escape_odata_string(organization)
        filter_expr = f"organization eq '{escaped}'"
        try:
            pdf_files = await asyncio.to_thread(collect_pdf_files_from_search, filter_expr)
            existing_pages = sum(pdf_files.values()) if pdf_files else 0
        except Exception:
            logging.exception("Unexpected error when checking existing pages")
            existing_pages = 0

        # Calculate pages in new PDF files
        new_pages = 0
        for uploaded_file in files:
            if uploaded_file.filename.lower().endswith('.pdf'):
                content = uploaded_file.read()
                doc = fitz.open(stream=content, filetype="pdf")
                new_pages += doc.page_count
                doc.close()
                uploaded_file.seek(0)  # Reset file pointer for processing

        if existing_pages + new_pages > 20:  # Free user limit
            return jsonify({
                "detail": f"Free users are limited to 20 PDF pages total. "
                          f"Current: {existing_pages}, New: {new_pages}"
            }), 400

    # Check if queue is full
    if upload_queue.qsize() >= JOB_QUEUE_MAX_SIZE:
        return jsonify({"detail": "Upload queue is full. Please try again later."}), 503

    job_id = str(uuid.uuid4())

    # Capture file content immediately before files are closed
    file_data = []
    for uploaded_file in files:
        # Make sure file pointer is at start
        try:
            uploaded_file.seek(0)
        except Exception:
            pass
        file_data.append({
            "filename": uploaded_file.filename,
            "content": uploaded_file.read(),
            "organization": organization
        })

    # Add job to queue instead of processing immediately
    upload_queue.put((job_id, file_data, False))
    update_job_status(job_id, "queued", result={"position_in_queue": upload_queue.qsize()})

    return jsonify({
        "job_id": job_id,
        "message": "Files added to processing queue",
        "position_in_queue": upload_queue.qsize()
    }), 202

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


@bp.route("/api/embed", methods=["POST"])
async def embed_text():
    try:
        request_json = await request.get_json()
        text = request_json.get("input", "")
        if not text:
            return jsonify({"error": "Error: 'input' field is empty."}), 400

        logging.info("Quart endpoint for text embedding has been called.")

        # 1) Generate the raw embedding
        try:
            vec = generate_embeddings(text)
        except Exception as e:
            logging.exception("Error generating embedding")
            return jsonify({"error": f"Error generating embedding: {str(e)}"}), 500

        # 2) If it's a 2-D array, take the first (and only) row
        if hasattr(vec, "ndim") and vec.ndim > 1:
            vec = vec[0]

        # 3) Convert to a list (may still contain numpy types or nested lists)
        embedding_list = vec.tolist() if hasattr(vec, "tolist") else vec

        # 4) If you still have a nested list (e.g. [[…]]), flatten one level
        if embedding_list and isinstance(embedding_list[0], list):
            embedding_list = embedding_list[0]

        # 5) Coerce each element to a built-in Python float
        embedding_list = [float(x) for x in embedding_list]

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
    

@bp.route("/get-pdf", methods=["GET"])
async def get_pdf():
    # Get the file name from query parameters
    file_name = request.args.get("file_name")
    
    if not file_name:
        return jsonify({"error": "file_name parameter is required"}), 400

    try:
        # Access the blob container
        container_client = blob_service_client.get_container_client(container_name)
        blob_client = None

        if '/' in file_name:
            # If '/' is in file_name, treat it as a full path
            blob_client = container_client.get_blob_client(file_name)
            # Check if the blob exists
            if not blob_client.exists():
                return jsonify({"error": "File not found"}), 404
        else:
            # If no '/' in file_name, search for the file by name
            for blob in container_client.list_blobs():
                # Extract the file name from the blob's name
                blob_base_name = blob.name.split('/')[-1]
                if blob_base_name == file_name:
                    blob_client = container_client.get_blob_client(blob.name)
                    break
            if not blob_client:
                return jsonify({"error": "File not found"}), 404
        
        # Download the blob data
        download_stream = blob_client.download_blob()
        
        # Return the PDF with the inline disposition so it opens in the browser
        return Response(
            download_stream.readall(),
            mimetype="application/pdf",
            headers={"Content-Disposition": f"inline; filename={file_name}"}
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

 # Helpers for upload xml

def inline_to_md(elem) -> str:
    """
    Recursively convert an element and its children to inline Markdown,
    handling <strong>, <em>, <code>, <a>, <img>, <br>, <span>, and other inline tags.
    """
    parts: List[str] = []
    # Text before children
    if elem.text:
        parts.append(elem.text)

    for child in elem:
        tag = child.tag.lower()
        if tag in ("strong", "b"):
            parts.append(f"**{inline_to_md(child)}**")
        elif tag in ("em", "i"):
            parts.append(f"*{inline_to_md(child)}*")
        elif tag == "code":
            code_text = (child.text or "").strip()
            parts.append(f"`{code_text}`")
        elif tag == "a":
            href = child.attrib.get("href", "").strip()
            link_text = inline_to_md(child)
            parts.append(f"[{link_text}]({href})")
        elif tag == "img":
            src = child.attrib.get("href", child.attrib.get("src", "")).strip()
            alt = child.attrib.get("alt", child.attrib.get("id", "")).strip()
            parts.append(f"![{alt}]({src})")
        elif tag == "br":
            parts.append("  \n")  # Markdown line break
        else:
            # For <span> and unknown inline tags, ignore tag but recurse
            parts.append(inline_to_md(child))

        # Tail text after this child
        if child.tail:
            parts.append(child.tail)

    return "".join(parts).strip()


def elem_to_markdown(elem, level: int = 0) -> List[str]:
    """
    Convert XML element tree to Markdown lines, handling headings,
    paragraphs (including code blocks), lists, tables, images, footnotes.
    """
    md_lines: List[str] = []
    tag = elem.tag.lower()
    indent = "  " * level

    # --- Headings ---
    if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
        level_num = int(tag[1])
        prefix = "#" * level_num
        text = inline_to_md(elem)
        md_lines.append(f"{prefix} {text}")
        return md_lines

    # --- Paragraphs & Code Blocks ---
    if tag == "p":
        if elem.attrib.get("class", "").lower() == "code":
            md_lines.append("```")
            md_lines.extend((elem.text or "").splitlines())
            md_lines.append("```")
        else:
            text = inline_to_md(elem)
            if text:
                md_lines.append(text)
        return md_lines

    # --- Lists ---
    if tag in ("list", "ul", "ol"):
        list_type = elem.attrib.get("type", "bullet")
        is_ordered = list_type != "bullet" or tag == "ol"
        for li in elem.findall("li"):
            p_child = li.find("p")
            content = inline_to_md(p_child) if p_child is not None else inline_to_md(li)
            prefix = f"{indent}{(str(li.attrib.get('value')) + '.') if is_ordered else '-'} "
            md_lines.append(f"{prefix}{content}")
            # Nested lists
            for sub in li:
                if sub.tag.lower() in ("list", "ul", "ol"):
                    md_lines.extend(elem_to_markdown(sub, level + 1))
        return md_lines

    # --- Tables ---
    if tag == "table":
        tgroup = elem.find("tgroup") or elem
        rows = tgroup.findall("row")
        if rows:
            headers = [inline_to_md(cell) for cell in rows[0].findall("entry")]
            md_lines.append("| " + " | ".join(headers) + " |")
            md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
            for row in rows[1:]:
                cells = [inline_to_md(cell) for cell in row.findall("entry")]
                md_lines.append("| " + " | ".join(cells) + " |")
        return md_lines

    # --- Footnotes ---
    if tag == "footnote":
        foot = "".join(elem.itertext()).strip()
        if foot:
            md_lines.append(f"> **Footnote:** {foot}")
        return md_lines

    # --- Fallback: recurse into children ---
    for child in elem:
        md_lines.extend(elem_to_markdown(child, level))

    return md_lines

def chunk_text(text: str, chunk_size: int = 5000) -> List[str]:
    """Split text into ~chunk_size chars while respecting code blocks & sentences."""
    chunks, start, length = [], 0, len(text)
    while start < length:
        end = min(start + chunk_size, length)
        segment = text[start:end]

        # try to cut nicely
        cut = max(
            segment.rfind('```'),        # code block fence
            segment.rfind('\n\n'),       # paragraph
            segment.rfind('. '),         # sentence end
        )
        if cut != -1 and cut > chunk_size * 0.3:
            end = start + cut + (0 if cut == segment.rfind('```') else 1)

        chunks.append(text[start:end].strip())
        start = end
    return [c for c in chunks if c]


def process_xml_file(
    xml_data: bytes,
    organization: str,
    file_name: str,
):
    """
    Parse XML data from bytes and return a list of documents ready for
    `search_client.upload_documents`.
    """
    try:
        root = ET.fromstring(xml_data)
        base_name = os.path.splitext(file_name)[0]  # Define base_name here
        docs_array = []
        
        # --- NEW: Handle hyrox_documents structure ---
        if root.tag == "hyrox_documents":
            return process_hyrox_documents(root, organization, file_name)
        
        # --- NEW FORMAT DETECTION (by presence of <details> tag) ---
        def is_new_format(elem):
            """Check if element has a <details> child"""
            return elem.find("details") is not None
        
        # Case 1: Root is container element (like <artists>) with multiple items
        if any(is_new_format(child) for child in root):
            for item in root:
                if is_new_format(item):
                    process_new_format_item(item, docs_array, organization, file_name)
            return docs_array
        
        # Case 2: Root itself is an item with details
        if is_new_format(root):
            process_new_format_item(root, docs_array, organization, file_name)
            return docs_array
        
        # --- EXISTING PROCESSING FOR OLD FORMAT ---
        # Handle different root types
        if root.tag == "folder":
            folder_elem = root
        elif root.tag == "document":
            # Create virtual folder for single document
            folder_elem = ET.Element("folder")
            folder_elem.append(root)
        else:
            # Look for nested folder or create virtual container
            folder_elem = root.find("folder") 
            if folder_elem is None:
                folder_elem = ET.Element("folder")
                # Collect all document/folder elements
                for child in root:
                    if child.tag in ["document", "folder"]:
                        folder_elem.append(child)
        
        # -- depth-first traversal of folders & docs -----------------------------
        def traverse(folder_elem, parent_folder_id=None, parent_folder_name=None):
            fid = folder_elem.attrib.get("id", parent_folder_id)
            fname = folder_elem.findtext("naam", parent_folder_name or base_name).strip()
            meta_elem = folder_elem.find("meta")

            
            # Build tags array
            tags = []
            
            # Always include the folder name as a tag
            if fname:
                tags.append(fname)
                
            if meta_elem is not None:
                # guidesummary (direct under meta)
                guidesummary_elem = meta_elem.find("guidesummary")
                if guidesummary_elem is not None:
                    guide_text = (guidesummary_elem.text or "").strip()
                    if guide_text:
                        tags.append(guide_text)

            # process <document> children
            for doc in folder_elem.findall("document"):
                doc_id = doc.attrib.get("id", "")
                meta_elem = doc.find("meta")

                categories = []

                if meta_elem is not None:
                    # bi_category directly under <meta>
                    bi_cat_elem = meta_elem.find("bi_category")
                    if bi_cat_elem is not None:
                        bi_cat_text = (bi_cat_elem.text or "").strip()
                        if bi_cat_text:
                            categories.append(bi_cat_text)

                    # bi_subcategory directly under <meta>
                    bi_subcat_elem = meta_elem.find("bi_subcategory")
                    if bi_subcat_elem is not None:
                        bi_subcat_text = (bi_subcat_elem.text or "").strip()
                        if bi_subcat_text:
                            categories.append(bi_subcat_text)
                    
                title = doc.findtext("naam", "").strip() or "(untitled)"
                body_section = doc.find("document/section")
                markdown = "\n\n".join(elem_to_markdown(body_section)) if body_section is not None else ""

                for idx, chunk in enumerate(chunk_text(markdown), 1):
                    header = f"{title} - Chunk {idx}"
                    content = f"{header}\n\n{chunk}"
                    content_vector = generate_embeddings(content)

                    docs_array.append({
                        "id": str(uuid.uuid4()),
                        "chunk_id": doc_id,
                        "parent_id": fid,
                        "organization": organization,
                        "title": f"{title} - Part {idx}",
                        "page_number": None,
                        "total_pages": None,
                        "file": file_name,
                        "url": "",
                        "content": content,
                        "category": categories,
                        "tags": tags,
                        "contentVector": content_vector,
                    })

            # recurse into sub-folders
            for sub in folder_elem.findall("folder"):
                traverse(sub, fid, fname)

        traverse(folder_elem, parent_folder_name=base_name)
        return docs_array
        
    except ET.ParseError as e:
        raise ValueError(f"Failed to parse XML data: {e}")

def process_hyrox_documents(root, organization: str, file_name: str):
    """
    Process the hyrox_documents XML structure where each <document> contains
    fields like id, title, category, author, date, version, lms_id, url, tags, summary, content.
    For large contents we split into smaller chunks before calling the embedding model.
    """
    docs_array = []
    
    for doc_elem in root.findall("document"):
        try:
            # Extract all fields with safe handling for missing elements
            doc_id = get_text_safe(doc_elem, "id", "unknown_id")
            title = get_text_safe(doc_elem, "title", "Untitled")
            category = get_text_safe(doc_elem, "category", "")
            author = get_text_safe(doc_elem, "author", "")
            date = get_text_safe(doc_elem, "date", "")
            version = get_text_safe(doc_elem, "version", "")
            lms_id = get_text_safe(doc_elem, "lms_id", "")
            url = get_text_safe(doc_elem, "url", "")
            tags = get_text_safe(doc_elem, "tags", "")
            summary = get_text_safe(doc_elem, "summary", "")
            content = get_text_safe(doc_elem, "content", "")
            
            # Process tags into keywords array
            keywords = []
            if tags:
                keywords = [tag.strip() for tag in tags.split(",") if tag.strip()]
            
            # --- NEW: build base text for chunking WITHOUT title, only category + summary + content ---
            md_parts_for_chunking = []

            if category:
                md_parts_for_chunking.append(f"Category: {category}")
            if summary:
                md_parts_for_chunking.append(f"Summary:\n{summary}")
            if content:
                md_parts_for_chunking.append(content)

            combined_markdown = "\n\n".join(md_parts_for_chunking).strip()
            if not combined_markdown:
                # Nothing meaningful to embed, skip this document
                logging.warning(f"HYROX doc {doc_id} has no summary/content; skipping.")
                continue

            # Chunk the combined markdown to keep each embedding call small enough
            chunks = chunk_hyrox_text(combined_markdown, chunk_size=5000, overlap=500)

            for idx, chunk in enumerate(chunks, start=1):
                try:
                    # At the start of each chunk, prepend the title + chunk number
                    chunk_title = title if len(chunks) == 1 else f"{title} - Chunk {idx}"
                    chunk_text = f"# {title} - Chunk {idx}\n\n{chunk}"

                    content_vector = generate_embeddings(chunk_text)
                except Exception as e:
                    logging.error(
                        f"Embedding error for HYROX doc {doc_id} chunk {idx}: {e}"
                    )
                    continue

                doc = {
                    "id": str(uuid.uuid4()),
                    "chunk_id": f"{doc_id}_chunk_{idx}",
                    "parent_id": doc_id,  # keep original HYROX id as parent
                    "organization": organization,
                    "title": chunk_title,
                    "page_number": None,
                    "total_pages": None,
                    "file": file_name,
                    "url": url,
                    "content": chunk_text,        # store the chunk WITH title+chunk header
                    "contentVector": content_vector,
                    "category": [category] if category else [],
                    "tags": keywords,
                    # You still have author/date/version/lms_id if you want to add separate fields later
                }
                docs_array.append(doc)

        except Exception as e:
            logging.error(f"Error processing document element in hyrox_documents: {e}")
            continue
    
    logging.info(f"Processed {len(docs_array)} documents from hyrox_documents XML")
    return docs_array


def chunk_hyrox_text(text: str, chunk_size: int = 5000, overlap: int = 500) -> List[str]:
    """Chunk text with overlap to preserve context continuity."""
    chunks: List[str] = []
    length = len(text)
    if length == 0:
        return chunks

    # basic sanity
    chunk_size = max(chunk_size, 1000)
    overlap = max(min(overlap, chunk_size // 2), 0)

    start = 0
    while start < length:
        end = min(start + chunk_size, length)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= length:
            break

        # move start forward but keep overlap
        new_start = end - overlap
        if new_start <= start:
            # avoid infinite loop if overlap is misconfigured
            new_start = end
        start = new_start

    return chunks


def get_text_safe(element, tag_name, default=""):
    """Safely get text from an XML element, return default if not found"""
    elem = element.find(tag_name)
    return elem.text.strip() if elem is not None and elem.text else default


def process_new_format_item(item, docs_array, organization, file_name):
    """Process a single item in the new XML format"""
    item_id = item.attrib.get("id", str(uuid.uuid4()))
    details = item.find("details")
    main_tag = item.tag
    
    if details is None:
        return
    
    category = []
    tags = []

    if details is not None:
        # category: main genre
        hg = details.find("hauptgenre/item")
        if hg is not None and (t := (hg.text or "").strip()):
            category.append(t)

        # tags: weitere_genres
        wg_elem = details.find("weitere_genres")
        if wg_elem is not None:
            for item in wg_elem.findall("item"):
                txt = (item.text or "").strip()
                if txt:
                    tags.append(txt)

        # tags: instrumente
        inst_elem = details.find("instrumente")
        if inst_elem is not None:
            for item in inst_elem.findall("item"):
                txt = (item.text or "").strip()
                if txt:
                    tags.append(txt)
    
    # Build markdown content
    markdown = f"## {main_tag.capitalize()} {item_id}\n\n"
    
    for field in details:
        field_name = field.tag.replace('_', ' ').title()
        values = []
        
        # Handle different value structures
        if field.text and field.text.strip():
            values.append(field.text.strip())
            
        for child in field:
            if child.text and child.text.strip():
                values.append(child.text.strip())
            elif child.tail and child.tail.strip():
                values.append(child.tail.strip())
                
        if values:
            if len(values) == 1:
                markdown += f"**{field_name}:** {values[0]}\n\n"
            else:
                markdown += f"**{field_name}:**\n"
                markdown += "\n".join(f"- {v}" for v in values) + "\n\n"
    
    # Generate embeddings
    content_vector = generate_embeddings(markdown)
    
    docs_array.append({
        "id": str(uuid.uuid4()),
        "chunk_id": item_id,
        "parent_id": "",
        "organization": organization,
        "title": f"{main_tag.capitalize()} {item_id}",
        "page_number": 0,
        "total_pages": 0,
        "file": file_name,
        "url": "",
        "content": markdown,
        "category": category,
        "tags": tags,
        "contentVector": content_vector,
    })

async def process_single_xml_file(filename: str, content: bytes, organization: str):
    blob_path = f"{organization}/{filename}"
    blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)

    if blob_client.exists():
        return None, filename  # Skip existing

    try:
        loop = asyncio.get_running_loop()
        
        # Offload XML processing to thread pool
        docs_array = await loop.run_in_executor(
            executor,
            lambda: process_xml_file(
                xml_data=content,
                organization=organization,
                file_name=filename
            )
        )
        
        # Upload documents in smaller batches
        for i in range(0, len(docs_array), 5):  # 5 documents per batch
            batch = docs_array[i:i+5]
            try:
                search_client.upload_documents(batch)
                await asyncio.sleep(0.3)  # Throttle requests
            except Exception as e:
                logging.error(f"Batch upload failed for {filename}: {str(e)}")
        
        # Upload original XML to blob storage
        blob_client.upload_blob(content)
        return filename, None
    
    except Exception as e:
        logging.error(f"Failed to process {filename}: {str(e)}")
        return None, filename
    finally:
        # Explicit memory cleanup
        del content
        gc.collect()
        

# Similarly modify the XML upload endpoint
@bp.route("/pipeline/upload_xml", methods=["POST"])
async def upload_xml_files():
    form = await request.form
    files = (await request.files).getlist("files")
    organization = form.get("organization", "").strip().lower().strip('.')
    
    if not organization:
        return jsonify({"detail": "Missing 'organization' field."}), 400
    
    # Check if queue is full
    if upload_queue.qsize() >= JOB_QUEUE_MAX_SIZE:
        return jsonify({"detail": "Upload queue is full. Please try again later."}), 503
    
    job_id = str(uuid.uuid4())
    
    # Capture file content immediately before files are closed
    file_data = []
    for uploaded_file in files:
        file_data.append({
            "filename": uploaded_file.filename,
            "content": uploaded_file.read(),
            "organization": organization
        })
    
    # Add job to queue instead of processing immediately
    upload_queue.put((job_id, file_data, True))
    update_job_status(job_id, "queued", result={"position_in_queue": upload_queue.qsize()})
    
    return jsonify({
        "job_id": job_id,
        "message": "Files added to processing queue",
        "position_in_queue": upload_queue.qsize()
    }), 202


async def async_process_files(file_data, job_id, is_xml=False):
    try:
        processed_files = []
        skipped_files = []
        
        for file_info in file_data:
            if is_xml:
                processed, skipped = await process_single_xml_file(
                    file_info["filename"],
                    file_info["content"],
                    file_info["organization"]
                )
            else:
                processed, skipped = await process_single_file(
                    file_info["filename"],
                    file_info["content"],
                    file_info["organization"]
                )
            
            if processed:
                processed_files.append(processed)
            if skipped:
                skipped_files.append(skipped)
        
        update_job_status(job_id, "completed", {
            "processed_files": processed_files,
            "skipped_files": skipped_files
        })
    except Exception as e:
        logging.error(f"Background job failed: {str(e)}")
        update_job_status(job_id, "failed", error=str(e))


# Enhance the job status function to include queue position
@bp.route("/pipeline/job_status/<job_id>", methods=["GET"])
async def get_job_status(job_id: str):
    with job_lock:
        job = upload_jobs.get(job_id)
    
    if not job:
        return jsonify({"error": "Job not found"}), 404
    
    # Add queue position for queued jobs
    response_data = {
        "job_id": job_id,
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error"),
        "timestamp": job["timestamp"]
    }
    
    if job["status"] == "queued":
        # Calculate position in queue
        position = 1
        for i in range(upload_queue.qsize()):
            queued_job_id, _, _ = upload_queue.queue[i]
            if queued_job_id == job_id:
                response_data["position_in_queue"] = position
                break
            position += 1
    
    return jsonify(response_data)

@bp.route("/pipeline/pdf_page_count", methods=["GET"])
async def get_pdf_page_count():
    company_name = request.args.get("company", "").strip().lower().strip('.')

    if not company_name:
        return jsonify({"total_pages": 0})

    # Escape company name for OData filter
    escaped = _escape_odata_string(company_name)
    # Use endswith properly: endswith(file, '.pdf')
    filter_expr = f"organization eq '{escaped}'"

    try:
        pdf_files = await asyncio.to_thread(collect_pdf_files_from_search, filter_expr)
        total_pages = sum(pdf_files.values()) if pdf_files else 0
    except Exception:
        logging.exception("Azure Search HttpResponseError when fetching pdf page count")
        # return a safe response rather than crash
        return jsonify({"total_pages": 0, "error": "search_error"}), 200
    except Exception:
        logging.exception("Unexpected error when fetching pdf page count")
        return jsonify({"total_pages": 0, "error": "internal_error"}), 200

    return jsonify({"total_pages": total_pages})

def _escape_odata_string(s: str) -> str:
    # OData string literal single quotes must be doubled
    return s.replace("'", "''")

def collect_pdf_files_from_search(filter_expr: str):
    """Run the synchronous azure search and return {filename: total_pages}."""
    # Use a different approach - get unique files and their page counts
    results = search_client.search(
        search_text="*",
        filter=filter_expr,
        select="file, total_pages",
        include_total_count=True
    )
    
    pdf_files_local = {}
    processed_files = set()
    
    for result in results:
        filename = result.get("file")
        
        if not filename or filename in processed_files:
            continue
            
        # For PDF files, we should have total_pages field
        total_pages = result.get("total_pages")
        if total_pages is not None:
            try:
                pdf_files_local[filename] = int(total_pages)
                processed_files.add(filename)
            except (ValueError, TypeError):
                pdf_files_local[filename] = 0
                processed_files.add(filename)
                
    return pdf_files_local

@bp.route("/users/list", methods=["GET"])
async def list_b2c_users_for_tenant():
    """
    Lists users from a specific B2C tenant using client credentials.
    Requires these env vars:
      B2C_TENANT_ID         -> the tenant id GUID or tenant domain (e.g. snapdeai.onmicrosoft.com)
      B2C_CLIENT_ID         -> app registration (client) id in that tenant
      B2C_CLIENT_SECRET     -> client secret for the app registration
    The app must have Application permission User.Read.All (or similar) with admin consent.
    """
    try:
        tenant = os.getenv("B2C_TENANT_ID")
        client_id = os.getenv("B2C_CLIENT_ID")
        client_secret = os.getenv("B2C_CLIENT_SECRET")

        if not (tenant and client_id and client_secret):
            return jsonify({"error": "Missing B2C_TENANT_ID, B2C_CLIENT_ID or B2C_CLIENT_SECRET env vars"}), 500

        # Use the async client credential targeted at the B2C tenant
        credential = ClientSecretCredential(
            tenant_id=tenant,
            client_id=client_id,
            client_secret=client_secret
        )

        # Acquire token for Microsoft Graph (application scope)
        token = await credential.get_token("https://graph.microsoft.com/.default")
        access_token = token.token

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        users = []
        url = (
            "https://graph.microsoft.com/v1.0/users?"
            "$select=id,displayName,userPrincipalName,identities,streetAddress,city"
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                resp = await client.get(url, headers=headers)
                if resp.status_code != 200:
                    text = await resp.aread()
                    await credential.close()
                    return jsonify({
                        "error": f"Graph API error: {resp.status_code}",
                        "details": text.decode(errors="ignore")
                    }), resp.status_code

                body = resp.json()
                users.extend(body.get("value", []))

                # paging
                url = body.get("@odata.nextLink")

        await credential.close()
        return jsonify({"value": users}), 200

    except Exception as e:
        logging.exception("Exception in /users/list endpoint")
        return jsonify({"error": str(e)}), 500

def count_tokens(text: str, model: str = "gpt-4") -> int:
    """Count tokens in text using tiktoken"""
    try:
        encoding = tiktoken.encoding_for_model(model)
        return len(encoding.encode(text))
    except Exception as e:
        logging.error(f"Error counting tokens: {e}")
        # Fallback: approximate token count (4 characters per token)
        return len(text) // 4

def calculate_cost(input_tokens: int, output_tokens: int) -> float:
    """Calculate cost based on GPT-4o pricing"""
    input_cost = (input_tokens / 1000) * GPT4O_INPUT_PRICE_PER_1K_TOKENS
    output_cost = (output_tokens / 1000) * GPT4O_OUTPUT_PRICE_PER_1K_TOKENS
    return round(input_cost + output_cost, 6)

async def update_estimated_costs(authenticated_user: dict, user_question: str, assistant_answer: str, conversation_id: str = None):
    """Update estimated costs for a user in CosmosDB"""
    try:
        user_id = authenticated_user["user_principal_id"]
        user_name = authenticated_user["user_name"]
        
        # Count tokens
        input_tokens = count_tokens(user_question)
        output_tokens = count_tokens(assistant_answer)
        cost = calculate_cost(input_tokens, output_tokens)
        
        # Get CosmosDB container
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        
        # Create collection if it doesn't exist
        existing_collections = [coll['id'] for coll in database.list_containers()]
        if ESTIMATED_COSTS_COLLECTION not in existing_collections:
            database.create_container(
                id=ESTIMATED_COSTS_COLLECTION, 
                partition_key=PartitionKey(path='/user_id')
            )
            logging.info(f"Created collection '{ESTIMATED_COSTS_COLLECTION}'.")
        
        container = database.get_container_client(ESTIMATED_COSTS_COLLECTION)
        
        # Check if user already has a cost record
        query = f"SELECT * FROM c WHERE c.user_id = '{user_id}'"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))
        
        if results:
            # Update existing record
            user_cost_record = results[0]
            user_cost_record["total_cost"] += cost
            user_cost_record["total_input_tokens"] += input_tokens
            user_cost_record["total_output_tokens"] += output_tokens
            user_cost_record["last_updated"] = datetime.utcnow().isoformat()
            user_cost_record["conversation_count"] = user_cost_record.get("conversation_count", 0) + 1
            
            # Store individual conversation details in history array
            conversation_detail = {
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "timestamp": datetime.utcnow().isoformat(),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost": cost,
                "user_question_preview": user_question[:100] + "..." if len(user_question) > 100 else user_question
            }
            
            if "conversation_history" not in user_cost_record:
                user_cost_record["conversation_history"] = []
            
            user_cost_record["conversation_history"].append(conversation_detail)
            # Keep only last 100 conversations to prevent document from growing too large
            if len(user_cost_record["conversation_history"]) > 100:
                user_cost_record["conversation_history"] = user_cost_record["conversation_history"][-100:]
            
            container.upsert_item(user_cost_record)
        else:
            # Create new record
            new_record = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "user_name": user_name,
                "total_cost": cost,
                "total_input_tokens": input_tokens,
                "total_output_tokens": output_tokens,
                "conversation_count": 1,
                "first_created": datetime.utcnow().isoformat(),
                "last_updated": datetime.utcnow().isoformat(),
                "conversation_history": [
                    {
                        "id": str(uuid.uuid4()),
                        "conversation_id": conversation_id,
                        "timestamp": datetime.utcnow().isoformat(),
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost": cost,
                        "user_question_preview": user_question[:100] + "..." if len(user_question) > 100 else user_question
                    }
                ]
            }
            container.create_item(new_record)
        
        logging.info(f"Updated cost for user {user_name}: ${cost} (Input: {input_tokens}, Output: {output_tokens} tokens)")
        
    except Exception as e:
        logging.error(f"Error updating estimated costs: {e}")

@bp.route("/costs/all", methods=["GET"])
async def get_all_costs():
    """Get cost information for all users (admin endpoint)"""
    try:
        database = cosmos_client.get_database_client(app_settings.chat_history.database)
        
        # Check if collection exists
        existing_collections = [coll['id'] for coll in database.list_containers()]
        if ESTIMATED_COSTS_COLLECTION not in existing_collections:
            return jsonify([])
        
        container = database.get_container_client(ESTIMATED_COSTS_COLLECTION)
        
        # Query all cost records
        query = "SELECT * FROM c"
        results = list(container.query_items(query=query, enable_cross_partition_query=True))
        
        # Return sorted by total_cost descending
        sorted_results = sorted(results, key=lambda x: x.get("total_cost", 0), reverse=True)
        
        return jsonify(sorted_results)
            
    except Exception as e:
        logging.error(f"Error retrieving all costs: {e}")
        return jsonify({"error": str(e)}), 500

app = create_app()
