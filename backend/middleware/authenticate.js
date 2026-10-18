const jwt = require("jsonwebtoken");

/**
 * authenticate — Express middleware for JWT-protected routes.
 *
 * Expected header:
 *   Authorization: Bearer <token>
 *
 * On success:  attaches req.user = { id, email, name } and calls next().
 * On failure:  responds immediately with 401 (never 500) so the route
 *              handler never runs.
 *
 * Why we handle every jwt error branch explicitly:
 *   - TokenExpiredError  → the token was once valid but has expired
 *   - JsonWebTokenError  → the token is malformed or the signature is wrong
 *   - NotBeforeError     → the token is not yet active (nbf claim)
 * All three are the client's problem (401), not a server bug (500).
 */
const authenticate = (req, res, next) => {
  // 1. Extract the Authorization header
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  // 2. Isolate the token string (everything after "Bearer ")
  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. Token is empty.",
    });
  }

  // 3. Verify the token against the same secret used to sign it
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    // This is a server configuration problem — log it but hide the detail from clients
    console.error("AUTH ERROR: JWT_SECRET is not set in environment");
    return res.status(500).json({
      success: false,
      message: "Authentication service is misconfigured.",
    });
  }

  try {
    // jwt.verify() throws synchronously on any error, so try/catch is the
    // correct pattern here (no callback needed).
    const decoded = jwt.verify(token, jwtSecret);

    // 4. Attach only the payload fields routes need — never the raw token
    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (error) {
    // Distinguish between an expired token and a completely invalid one
    // so the client knows whether to re-login or just refresh.
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired. Please log in again.",
      });
    }

    // JsonWebTokenError, NotBeforeError, or anything else jwt.verify() throws
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

module.exports = authenticate;
