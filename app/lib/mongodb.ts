import { MongoClient } from "mongodb";

declare global {
  var __digitalTwinMongoClientPromise: Promise<MongoClient> | undefined;
}

export async function getMongoDb() {
  const uri = process.env.MONGODB_URL;
  if (!uri) {
    throw new Error("Missing MONGODB_URL environment variable.");
  }

  if (!globalThis.__digitalTwinMongoClientPromise) {
    globalThis.__digitalTwinMongoClientPromise = new MongoClient(uri).connect();
  }

  const clientPromise = globalThis.__digitalTwinMongoClientPromise;

  const client = await clientPromise;
  return client.db();
}
