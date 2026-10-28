// lib/google-drive.ts
// OAuth2 + Google Drive integration for the "Enviar para o Drive" button.
// Tokens and the app's own root-folder id are persisted locally in
// .data/google-tokens.json (gitignored) — this is a personal, single-user,
// local-only tool, so a plain local JSON file is the simplest storage that
// fits the project's existing "no DB, local files only" pattern (same as
// /tmp/jobs/{jobId}).
import { google } from "googleapis";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readdir } from "node:fs/promises";

const DATA_DIR = path.join(process.cwd(), ".data");
const TOKEN_PATH = path.join(DATA_DIR, "google-tokens.json");

// Full "drive" scope: needed because the destination folder is configured
// via GOOGLE_DRIVE_ROOT_FOLDER_ID to an existing folder created manually by
// the user (not by this app) — the narrower drive.file scope can only see
// files/folders the app itself created, so it can't list or write inside a
// pre-existing folder. This grants the app read/write access to the user's
// whole Drive; if you ever want to go back to the narrower scope, point
// GOOGLE_DRIVE_ROOT_FOLDER_ID at nothing and let the app manage its own
// "CONTENT LAB | Gui Simara" folder again.
const SCOPES = ["https://www.googleapis.com/auth/drive"];

interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
  rootFolderId?: string; // "CONTENT LAB | Gui Simara" folder created by the app
}

function readStoredTokens(): StoredTokens | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens: StoredTokens) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Variável de ambiente ${name} não configurada. Veja .env.local.example.`
    );
  }
  return v;
}

export function getOAuthClient() {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time we (re)connect
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(code: string): Promise<void> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  const existing = readStoredTokens() || {};
  writeStoredTokens({
    ...existing,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || existing.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: tokens.expiry_date,
  });
}

export function isDriveConnected(): boolean {
  const stored = readStoredTokens();
  return !!stored?.refresh_token;
}

export function disconnectDrive(): void {
  if (existsSync(TOKEN_PATH)) writeFileSync(TOKEN_PATH, "{}");
}

function getAuthedClient() {
  const stored = readStoredTokens();
  if (!stored?.refresh_token) {
    throw new Error("DRIVE_NOT_CONNECTED");
  }
  const client = getOAuthClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expiry_date,
  });
  // Persist refreshed access tokens so we don't have to re-auth every call.
  client.on("tokens", (tokens) => {
    const current = readStoredTokens() || {};
    writeStoredTokens({
      ...current,
      access_token: tokens.access_token || current.access_token,
      refresh_token: tokens.refresh_token || current.refresh_token,
      expiry_date: tokens.expiry_date || current.expiry_date,
    });
  });
  return client;
}

async function ensureRootFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  // If the user pointed GOOGLE_DRIVE_ROOT_FOLDER_ID at an existing Drive
  // folder, use it as-is instead of the app's auto-created one. Note: with
  // the drive.file scope, this only works if that folder was itself created
  // by this app, or was explicitly opened with it via a picker — a folder
  // created manually in Drive's own UI is invisible to this scope. See
  // .env.local.example for details.
  const configuredId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (configuredId) return configuredId;

  const stored = readStoredTokens() || {};
  if (stored.rootFolderId) {
    // Confirm it still exists (user may have deleted it manually).
    try {
      await drive.files.get({ fileId: stored.rootFolderId, fields: "id, trashed" });
      return stored.rootFolderId;
    } catch {
      // fall through and recreate
    }
  }
  const res = await drive.files.create({
    requestBody: {
      name: "CONTENT LAB | Gui Simara",
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  const rootFolderId = res.data.id!;
  writeStoredTokens({ ...stored, rootFolderId });
  return rootFolderId;
}

// Looks at the immediate subfolders of `parentFolderId`, keeps only the ones
// named as a plain integer ("1", "01", "012", "15", ...), and returns the
// next number in that sequence as a string. Starts at "1" if none exist yet.
// Preserves the digit-count/leading-zero style of the highest existing
// folder (e.g. if the max is "012", the next one is "013"; if the max is
// "15", the next one is "16") to match whatever manual convention is
// already in use in that folder.
async function getNextSequentialFolderName(
  drive: ReturnType<typeof google.drive>,
  parentFolderId: string
): Promise<string> {
  let max = 0;
  let maxNameLength = 0;
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 1000,
      pageToken,
    });
    for (const f of res.data.files || []) {
      const match = /^(\d+)$/.exec((f.name || "").trim());
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) {
          max = n;
          maxNameLength = match[1].length;
        }
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return String(max + 1).padStart(maxNameLength, "0");
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export interface DriveUploadResult {
  folderId: string;
  folderUrl: string;
  uploadedFiles: string[];
}

// Creates a job-specific subfolder — named with the next sequential number
// (1, 2, 3, ...) relative to whatever already exists inside the root Drive
// folder — and uploads every rendered file from /tmp/jobs/{jobId} into it.
export async function uploadJobToDrive(jobId: string): Promise<DriveUploadResult> {
  const client = getAuthedClient();
  const drive = google.drive({ version: "v3", auth: client });

  const rootFolderId = await ensureRootFolder(drive);

  const jobDir = path.join("/tmp/jobs", jobId);
  const files = (await readdir(jobDir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  if (files.length === 0) {
    throw new Error("Nenhum arquivo encontrado para este job.");
  }

  const folderName = await getNextSequentialFolderName(drive, rootFolderId);
  const folderRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id, webViewLink",
  });
  const folderId = folderRes.data.id!;

  const uploadedFiles: string[] = [];
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    const { createReadStream } = await import("node:fs");
    await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: {
        mimeType: MIME_BY_EXT[ext] || "application/octet-stream",
        body: createReadStream(path.join(jobDir, filename)),
      },
      fields: "id",
    });
    uploadedFiles.push(filename);
  }

  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    uploadedFiles,
  };
}
