"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const env_1 = require("../src/config/env");
const app_config_1 = require("../src/config/app-config");
const seed_1 = require("../src/modules/rbac/seed");
const prisma = new client_1.PrismaClient();
const main = async () => {
    (0, env_1.initializeEnv)();
    const config = (0, app_config_1.loadAppConfig)();
    await (0, seed_1.seedCoreRbac)(prisma, config.PASSWORD_MIN_LENGTH);
    // eslint-disable-next-line no-console
    console.log('Seed data applied successfully.');
};
main()
    .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to seed database', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map