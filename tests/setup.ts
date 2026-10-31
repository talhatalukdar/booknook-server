process.env.NODE_ENV = "test";
process.env.MONGODB_URI ??= process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017";
process.env.DB_NAME = `booknook_test_${process.pid}`;
process.env.CLIENT_URL = "http://localhost:3000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
