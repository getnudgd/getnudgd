import type { Database } from "../../adapters/db/types";
import { rulesSchema, packsSchema, type Rules, type CreditPack } from "./schemas";

export interface ConfigDeps {
  db: Database;
}

export interface RulesWithVersion {
  rules: Rules;
  version: number;
}

export class ConfigNotFoundError extends Error {
  constructor(key: string, version?: number) {
    super(version ? `app_config "${key}" version ${version} not found` : `app_config "${key}" has no rows`);
    this.name = "ConfigNotFoundError";
  }
}

export async function getRules(deps: ConfigDeps, version?: number): Promise<Rules> {
  const row = version ? await deps.db.config.getVersion("rules", version) : await deps.db.config.getLatest("rules");
  if (!row) throw new ConfigNotFoundError("rules", version);
  return rulesSchema.parse(row.value);
}

export async function getRulesWithVersion(deps: ConfigDeps, version?: number): Promise<RulesWithVersion> {
  const row = version ? await deps.db.config.getVersion("rules", version) : await deps.db.config.getLatest("rules");
  if (!row) throw new ConfigNotFoundError("rules", version);
  return { rules: rulesSchema.parse(row.value), version: row.version };
}

export async function getPacks(deps: ConfigDeps): Promise<CreditPack[]> {
  const row = await deps.db.config.getLatest("credit_packs");
  if (!row) throw new ConfigNotFoundError("credit_packs");
  return packsSchema.parse(row.value);
}
