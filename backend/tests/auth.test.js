
const request = require("supertest");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "proxispeak-test-secret";

const app = require("../app");

describe("ProxiSpeak Authentication Tests", () => {

  // Test 1: Missing token
  test("Should reject request without token", async () => {
    const response = await request(app)
      .get("/api/users/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. No token provided."
    );
  });

  // Test 2: Bearer header without a token
  test("Should reject Bearer header without token", async () => {
    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Access denied. No token provided."
    );
  });

  // Test 3: Invalid JWT
  test("Should reject invalid JWT", async () => {
    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer invalid.jwt.token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Invalid token.");
  });

  // Test 4: Expired JWT
  test("Should reject expired JWT", async () => {
    const expiredToken = jwt.sign(
      {
        id: "test-user-id",
        email: "test@example.com",
        name: "Test User"
      },
      process.env.JWT_SECRET,
      { expiresIn: -10 }
    );

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      "Token has expired. Please log in again."
    );
  });

});
