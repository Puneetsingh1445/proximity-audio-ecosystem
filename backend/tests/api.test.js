
const request = require("supertest");
const app = require("../app");

describe("ProxiSpeak Backend API Tests", () => {

  test("Health API should return status 200", async () => {
    const response = await request(app)
      .get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe(
      "ProxiSpeak backend is running"
    );
  });

  test("Invalid API route should return status 404", async () => {
    const response = await request(app)
      .get("/api/invalid-test-route");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Route not found");
  });

});
