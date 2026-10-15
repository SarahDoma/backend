import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretProvider } from './secret-provider';

/**
 * Reads `<KEY>` from the file named by `<KEY>_FILE` (e.g. `JWT_SECRET_FILE`).
 * This is how Docker / Kubernetes secrets and secrets-manager sidecars (Vault
 * Agent, the AWS / GCP Secrets Store CSI drivers) expose values, so the
 * secret never has to live in the process environment. Surrounding
 * whitespace, including the trailing newline most tools write, is trimmed.
 */
@Injectable()
export class FileSecretProvider implements SecretProvider {
  readonly name = 'file';

  constructor(private readonly config: ConfigService) {}

  async getSecret(key: string): Promise<string | undefined> {
    const path = this.config.get<string>(`${key}_FILE`);
    if (!path) return undefined;
    try {
      return (await readFile(path, 'utf8')).trim();
    } catch (err) {
      throw new Error(
        `Could not read ${key} from ${key}_FILE (${path}): ${(err as Error).message}`,
      );
    }
  }
}
