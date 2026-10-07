import "dotenv/config";
import mongoose from "mongoose";
import Role from "../src/models/Role.js";
import User from "../src/models/User.js";

const TEST_DATABASE = "sahinsoy_test";
const SALES_ROLE = "Satış Temsilcisi";
const TEST_ADMIN_ROLE = "Test Yöneticisi";
const TEST_ADMIN = Object.freeze({
    user_username: "sahinsoy-test-admin",
    user_email: "sahinsoy-test-admin@example.invalid",
    user_phone: "+900000000001"
});

class SeedSafetyError extends Error {}

function requireTestDatabaseUri(rawUri) {
    if (!rawUri || rawUri !== rawUri.trim()) {
        throw new SeedSafetyError("MONGO_URI must be a MongoDB URI for sahinsoy_test.");
    }

    let parsed;
    try {
        parsed = new URL(rawUri);
    } catch {
        throw new SeedSafetyError("MONGO_URI could not be parsed; no connection attempted.");
    }

    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new SeedSafetyError("Only mongodb:// and mongodb+srv:// URIs are accepted.");
    }

    // Check the original path too: URL parsing normalizes dot segments.
    const rawPath = rawUri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+(\/[^?#]*)?/i)?.[1];
    // Require the literal database path, rejecting omitted, encoded or nested names.
    if (parsed.pathname !== `/${TEST_DATABASE}` || rawPath !== `/${TEST_DATABASE}`) {
        throw new SeedSafetyError("Refusing to seed any database other than sahinsoy_test.");
    }

    // Do not accept an ambiguous database override in connection-string options.
    for (const key of parsed.searchParams.keys()) {
        if (key.toLowerCase() === "dbname") {
            throw new SeedSafetyError("Remove dbName from MONGO_URI; use its database path.");
        }
    }

    return rawUri;
}

function requireTestPassword(password) {
    if (!password || password.trim().length < 12 || /^<.*>$/.test(password)) {
        throw new SeedSafetyError("Set TEST_ADMIN_PASSWORD to a real test password of at least 12 characters.");
    }
    return password;
}

async function ensureRole(roleName) {
    const existingRole = await Role.findOne({ role_name: roleName });
    if (existingRole) return existingRole;

    // The source contains no canonical permission names; do not invent them.
    return Role.create({ role_name: roleName, role_permissions: [] });
}

async function seedTestDatabase() {
    // Validate both inputs before opening any database connection.
    const mongoUri = requireTestDatabaseUri(process.env.MONGO_URI);
    const password = requireTestPassword(process.env.TEST_ADMIN_PASSWORD);

    await mongoose.connect(mongoUri, {
        dbName: TEST_DATABASE,
        autoCreate: false,
        autoIndex: false,
        serverSelectionTimeoutMS: 10000
    });

    try {
        if (mongoose.connection.name !== TEST_DATABASE) {
            throw new SeedSafetyError("Connected database is not sahinsoy_test; refusing all seed writes.");
        }

        const existingUser = await User.findOne({
            $or: [
                { user_username: TEST_ADMIN.user_username },
                { user_email: TEST_ADMIN.user_email },
                { user_phone: TEST_ADMIN.user_phone }
            ]
        });

        if (existingUser) {
            const isSameIdentity = Object.entries(TEST_ADMIN).every(
                ([key, value]) => existingUser[key] === value
            );
            const existingRole = await Role.findById(existingUser.user_role);
            if (!isSameIdentity || existingRole?.role_name !== TEST_ADMIN_ROLE) {
                throw new SeedSafetyError("A seed identity conflicts with an existing user; no users changed.");
            }
        }

        await ensureRole(SALES_ROLE);
        const adminRole = await ensureRole(TEST_ADMIN_ROLE);

        if (existingUser) {
            console.log("Test admin already exists; its password and role were not changed.");
            return;
        }

        // User.create runs the existing model's password-hashing save hook.
        await User.create({
            ...TEST_ADMIN,
            user_password: password,
            user_role: adminRole._id
        });

        console.log("Created synthetic test admin: sahinsoy-test-admin@example.invalid");
        console.log("Seed complete in sahinsoy_test. No canonical permission names were supplied.");
    } finally {
        await mongoose.disconnect();
    }
}

seedTestDatabase().catch(async (error) => {
    // Driver errors can contain connection details. Print only known validation text.
    if (error instanceof SeedSafetyError) {
        console.error(error.message);
    } else {
        console.error("Test seed failed. Check the isolated MongoDB instance and seed configuration.");
    }
    try {
        await mongoose.disconnect();
    } catch {
        // Preserve the seed failure status without logging connection details.
    }
    process.exitCode = 1;
});
