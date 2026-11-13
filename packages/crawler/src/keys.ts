import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** The sources that the crawler reads. */
export type SourceName = "digikey" | "ebay" | "bestbuy";

/** The names of the sources, in the order of the help text. */
export const SOURCE_NAMES: readonly SourceName[] = ["digikey", "ebay", "bestbuy"];

/** The variables of the key file for each source. */
export const KEY_VARIABLES: { readonly [S in SourceName]: readonly string[] } = {
  digikey: ["DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"],
  ebay: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
  bestbuy: ["BESTBUY_API_KEY"],
};

/** A key is printable ASCII with no space, from 8 to 4096 characters: the rule of the clients. */
const KEY = /^[!-~]{8,4096}$/;

/** The key file: `~/.market/seller-keys.env`. Only the crawler reads it. */
export function keyFile(home: string = homedir()): string {
  return join(home, ".market", "seller-keys.env");
}

/** The result of a read of the keys of one source. A problem names a variable, and does not show a value. */
export type KeysResult = { readonly ok: true; readonly keys: Readonly<Record<string, string>> } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * This function reads the keys of one source from the text of a key file, in the `.env` form of `util.parseEnv`.
 * A problem names the variable that is missing, empty or not a key. It does not show a value.
 */
export function readKeys(source: SourceName, text: string): KeysResult {
  const values = parseEnv(text);
  const keys: Record<string, string> = {};
  const problems: string[] = [];
  for (const name of KEY_VARIABLES[source]) {
    const value = values[name]?.trim() ?? "";
    if (value === "") problems.push(`The key file has no value for ${name}.`);
    else if (!KEY.test(value)) problems.push(`The value of ${name} is not a key: printable ASCII with no space, from 8 to 4096 characters.`);
    else keys[name] = value;
  }
  return problems.length === 0 ? { ok: true, keys } : { ok: false, problems };
}

/**
 * This function reads the keys of one source from the key file. A file that does not exist gives a problem with
 * the path of the file.
 */
export function loadKeys(source: SourceName, path: string = keyFile()): KeysResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    return { ok: false, problems: [`The crawler cannot read the key file ${path} (${code}).`] };
  }
  return readKeys(source, text);
}
