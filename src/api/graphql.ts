import { endpoints } from "../config.js";
import { CliError } from "../errors.js";
import { authedFetch } from "./http.js";

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

/** Runs a query/mutation against the datalayer (the same GraphQL API the web app uses). */
export async function gql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = (await authedFetch(endpoints.datalayer, {
    body: { query, variables },
    timeoutMs: 180_000,
  })) as GraphQLResponse<T>;
  if (res.errors?.length) {
    throw new CliError(`GraphQL: ${res.errors.map((e) => e.message).join("; ")}`);
  }
  if (!res.data) throw new CliError("GraphQL: respuesta vacía");
  return res.data;
}
