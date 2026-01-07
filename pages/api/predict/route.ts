import { NextApiRequest, NextApiResponse } from 'next';

export async function POST(req: NextApiRequest, res: NextApiResponse) {
  // Parse the incoming request body
  console.log(req.body);
  const body = req.body;

  if (!body.drugA || !body.drugB) {
    return {
      error: "Missing drug1 or drug2",
      status: 400
    };
  }

  try {
    // Forward the request to your prediction server with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch("http://184.72.90.98:8000/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drug1: body.drugA,
        drug2: body.drugB,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Prediction server returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Response from prediction server:", data);
    
    return {
      data,
      status: 200
    };

  } catch (error: any) {
    console.error("Prediction server error:", error);
    
    if (error.name === 'AbortError') {
      return {
        error: "Prediction server timeout - request took too long",
        status: 504
      };
    }
    
    if (error.cause?.code === 'ECONNREFUSED') {
      return {
        error: "Prediction server is not available. Please check if the server at 184.72.90.98:8000 is running.",
        status: 503
      };
    }

    return {
      error: error.message || "Failed to connect to prediction server",
      status: 500
    };
  }
}
