
const jwt = require("jsonwebtoken");

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

process.env.JWT_SECRET = "proxispeak-profile-test-secret";

const request = require("supertest");
const User = require("../models/User");
const app = require("../app");

const USER_ID = "507f1f77bcf86cd799439011";
const EMAIL = "profiletest@proxispeak.test";
const NAME = "Task4 Tester";

let mockUser;
let token;

function setupUser() {
  mockUser = {
    _id: USER_ID,
    id: USER_ID,
    name: NAME,
    email: EMAIL,
    position: [0, 0],
    passwordHash: "private-hash",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  User.findById.mockImplementation(() => {
    const query = {
      select: jest.fn().mockImplementation(() =>
        Promise.resolve(mockUser)
      ),
      then(resolve, reject) {
        return Promise.resolve(mockUser).then(resolve, reject);
      },
    };

    return query;
  });

  User.findByIdAndUpdate.mockImplementation((id, update) => {
    const changes = update.$set || update;

    Object.assign(mockUser, changes);
    mockUser.updatedAt = new Date();

    const query = {
      select: jest.fn().mockImplementation(() =>
        Promise.resolve(mockUser)
      ),
      then(resolve, reject) {
        return Promise.resolve(mockUser).then(resolve, reject);
      },
    };

    return query;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupUser();

  token = jwt.sign(
    {
      id: USER_ID,
      email: EMAIL,
      name: NAME,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

describe("GET /api/users/me", () => {
  test("returns own profile with valid token", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.user.name).toBe(NAME);
    expect(res.body.user.id).toBe(USER_ID);
    expect(Array.isArray(res.body.user.position)).toBe(true);
    expect(res.body.user.createdAt).toBeDefined();
    expect(res.body.user.updatedAt).toBeDefined();
  });

  test("never exposes passwordHash", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test("rejects missing token", async () => {
    const res = await request(app)
      .get("/api/users/me");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("rejects malformed token", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", "Bearer invalid.token");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("rejects missing Bearer prefix", async () => {
    const res = await request(app)
      .get("/api/users/me")
      .set("Authorization", token);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe("PATCH /api/users/me", () => {
  test("updates name only", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Updated Name");
    expect(res.body.user.email).toBe(EMAIL);
  });

  test("updates position only", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ position: [100, 200] });

    expect(res.status).toBe(200);
    expect(res.body.user.position).toEqual([100, 200]);
  });

  test("updates name and position together", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Both Updated",
        position: [50, 60],
      });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Both Updated");
    expect(res.body.user.position).toEqual([50, 60]);
  });

  test("never exposes passwordHash in PATCH response", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "HashCheck" });

    expect(res.status).toBe(200);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test("does not allow email changes", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "EmailTest",
        email: "attacker@evil.com",
      });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  test("rejects empty body", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("rejects whitespace-only name", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("rejects position that is not an array", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ position: "bad" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("rejects position with incorrect length", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ position: [100] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("rejects position outside office boundaries", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ position: [1500, 300] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("rejects unauthenticated PATCH", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .send({ name: "Hacker" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("ignores protected fields", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "LegitUpdate",
        passwordHash: "fake-hash",
        _id: "000000000000000000000001",
      });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("LegitUpdate");
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(String(res.body.user.id)).toBe(USER_ID);
    expect(res.body.user.email).toBe(EMAIL);
  });
});
