import { signInWithGoogle, signOut, getSession } from "../lib/auth.js";
import { apiFetch } from "../lib/api.js";

const $ = (id) => document.getElementById(id);

function showError(err) {
  $("error").textContent = err?.message ?? String(err);
  $("error").hidden = !err;
}

function render(session) {
  $("signed-out").hidden = !!session;
  $("signed-in").hidden = !session;
  $("user-email").textContent = session?.user?.email ?? "";
  $("api-output").textContent = "";
}

async function withButton(button, fn) {
  button.disabled = true;
  showError(null);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showError(err);
  } finally {
    button.disabled = false;
  }
}

$("sign-in").addEventListener("click", (e) =>
  withButton(e.currentTarget, async () => render(await signInWithGoogle()))
);

$("sign-out").addEventListener("click", (e) =>
  withButton(e.currentTarget, async () => {
    await signOut();
    render(null);
  })
);

$("call-api").addEventListener("click", (e) =>
  withButton(e.currentTarget, async () => {
    const data = await apiFetch("/api/me");
    $("api-output").textContent = JSON.stringify(data, null, 2);
  })
);

getSession().then(render).catch(showError);
