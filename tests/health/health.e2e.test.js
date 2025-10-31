"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const container_1 = require("../../src/di/container");
describe('Health endpoints', () => {
    let container;
    beforeEach(() => {
        container = (0, container_1.buildContainer)();
    });
    afterEach(async () => {
        await container.dispose();
    });
    it('returns ok for /healthz', async () => {
        const app = container.resolve('app');
        const response = await (0, supertest_1.default)(app).get('/healthz');
        expect(response.status).toBe(200);
        expect(response.body.data.type).toBe('health');
        expect(response.body.data.attributes.status).toBe('ok');
        expect(response.body.meta.requestId).toEqual(expect.any(String));
    });
    it('returns ready for /readyz', async () => {
        const app = container.resolve('app');
        const response = await (0, supertest_1.default)(app).get('/readyz');
        expect(response.status).toBe(200);
        expect(response.body.data.type).toBe('readiness');
        expect(response.body.data.attributes.status).toBe('ready');
        expect(response.body.meta.requestId).toEqual(expect.any(String));
    });
});
//# sourceMappingURL=health.e2e.test.js.map