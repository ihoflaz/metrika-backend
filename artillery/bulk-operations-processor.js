/**
 * Artillery processor for bulk operations
 * 
 * Custom functions for request processing
 */

module.exports = {
  /**
   * Generate random string
   */
  randomString(userContext, events, done) {
    const length = 10;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    userContext.vars.randomString = result;
    return done();
  },

  /**
   * Log response time
   */
  logResponseTime(requestParams, response, context, ee, next) {
    if (response.timings) {
      console.log(`Response time: ${response.timings.response}ms`);
    }
    return next();
  },

  /**
   * Before request hook
   */
  beforeRequest(requestParams, context, ee, next) {
    // Add custom headers or modify request
    requestParams.headers = requestParams.headers || {};
    requestParams.headers['X-Load-Test'] = 'true';
    return next();
  },

  /**
   * After response hook
   */
  afterResponse(requestParams, response, context, ee, next) {
    // Log errors
    if (response.statusCode >= 400) {
      console.error(`Error ${response.statusCode}: ${requestParams.url}`);
    }
    return next();
  }
};
