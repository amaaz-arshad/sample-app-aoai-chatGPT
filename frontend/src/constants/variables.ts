import env from '../../../env.json'

export const FILTER_FIELD = env.find(e => e.name == 'A_AZURE_SEARCH_FILTER')?.value
