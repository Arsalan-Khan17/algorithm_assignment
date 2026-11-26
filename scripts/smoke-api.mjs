const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3100";

const response = await fetch(`${baseUrl}/api/support-requests`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerId: "00000000-0000-4000-8000-000000000001",
    message: "I want a refund for order 1043.",
  }),
});

console.log(response.status, await response.text());
