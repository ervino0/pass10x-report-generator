/**
 * Cloudflare Worker - Secure API Key Retrieval
 *
 * This worker securely stores the Gemini API key and returns it only to authorized requests.
 *
 * Environment Variables (Secrets) to configure in Cloudflare:
 * - GEMINI_API_KEY: Your Gemini API key from Google AI Studio
 * - AUTH_SECRET: A random secret token for authentication (generate a strong random string)
 */

export default {
  async fetch(request, env) {
    // CORS headers for Chrome extension
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    };

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Only accept GET or POST requests
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Check authentication
    const authHeader = request.headers.get('X-Auth-Token');

    if (!authHeader || authHeader !== env.AUTH_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    // Return the Gemini API key
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(JSON.stringify({
      apiKey: env.GEMINI_API_KEY,
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  },
};
