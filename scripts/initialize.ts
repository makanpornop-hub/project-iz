import "dotenv/config";
import { spawnSync } from "node:child_process";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
const migration = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  { stdio: "inherit" },
);
if (migration.status !== 0) process.exit(migration.status || 1);
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
const Bucket = process.env.S3_BUCKET!;
if (!Bucket) throw new Error("S3_BUCKET required");
let ok = false;
for (let i = 0; i < 15; i++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    ok = true;
    break;
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket }));
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!ok) throw new Error("Storage unavailable");
await s3.send(
  new PutBucketVersioningCommand({
    Bucket,
    VersioningConfiguration: { Status: "Enabled" },
  }),
);
console.log("Private storage initialized.");
