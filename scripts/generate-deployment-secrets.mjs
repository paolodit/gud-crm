import { randomBytes } from "node:crypto";

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

console.log(`# Fresh GUD deployment secrets — generated ${new Date().toISOString()}`);
console.log(`POSTGRES_PASSWORD=${secret(24)}`);
console.log(`BETTER_AUTH_SECRET=${secret(48)}`);
console.log(`SEED_ADMIN_PASSWORD=${secret(18)}`);
console.log("");
console.log("Store these in your password manager and CapRover. Do not commit or paste them into support messages.");
