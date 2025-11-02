/**
 * Artillery processor for Kanban operations
 */

module.exports = {
  /**
   * Simulate realistic user think time
   */
  thinkTime(userContext, events, done) {
    const thinkTimeMs = Math.floor(Math.random() * 2000) + 500; // 0.5-2.5 seconds
    setTimeout(done, thinkTimeMs);
  },

  /**
   * Log Kanban operation
   */
  logKanbanOperation(requestParams, response, context, ee, next) {
    if (response.statusCode === 200 && requestParams.url.includes('kanban')) {
      const operation = requestParams.url.split('/').pop();
      console.log(`Kanban ${operation}: ${response.timings.response}ms`);
    }
    return next();
  },

  /**
   * Before request hook
   */
  beforeRequest(requestParams, context, ee, next) {
    requestParams.headers = requestParams.headers || {};
    requestParams.headers['X-Load-Test'] = 'kanban';
    return next();
  }
};
