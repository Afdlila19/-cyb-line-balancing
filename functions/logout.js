export async function onRequest() {
  return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': 'cyb_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } });
}
