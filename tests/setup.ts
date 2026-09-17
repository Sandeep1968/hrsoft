import "dotenv/config";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.FIELD_ENCRYPTION_KEY ??= "0".repeat(64);
