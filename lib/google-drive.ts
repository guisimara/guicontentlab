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

// drive.file: the app can only see/create files and folders it created
// itself (or that the user explicitly opened via a picker). This is the
// minimal scope that still lets us create a folder and upload images into
// it — no access to the rest of the user's Drive.
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

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

// Creates a job-specific subfolder inside the app's own root Drive folder
// and uploads every rendered file from /tmp/jobs/{jobId} into it.
export async function uploadJobToDrive(jobId: string): Promise<DriveUploadResult> {
  const client = getAuthedClient();
  const drive = google.drive({ version: "v3", auth: client });

  const rootFolderId = await ensureRootFolder(drive);

  const jobDir = path.join("/tmp/jobs", jobId);
  const files = (await readdir(jobDir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  if (files.length === 0) {
    throw new Error("Nenhum arquivo encontrado para este job.");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const folderRes = await drive.files.create({
    requestBody: {
      name: `${stamp} - ${jobId.slice(0, 8)}`,
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
