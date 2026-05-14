// Public barrel for @emr/data-client.

export {
  createHttpClient,
  HttpError,
  type HttpClient,
  type HttpClientOptions,
  type HttpRequest,
  type HttpResponse,
  type TokenStore,
} from './fetch.js';
export {
  createAuthClient,
  type AuthClient,
  type LoginInput,
  type LoginResponse,
  type RefreshResponse,
  type SessionResponse,
} from './auth.js';
export {
  createHttpDataService,
  type PatientSummary,
} from './data-service.js';
