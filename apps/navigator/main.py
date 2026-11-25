"""
Browser Use navigator sidecar.

Purpose: open-ended *navigation* on sites where deterministic rules can't find the target form
(cookie walls, mega-menus, "choose account type" interstitials, SPA routers). It attaches to the
SAME Chromium the Node worker is driving (over CDP), moves it to the right page, and hands control
back. It is instructed never to type personal data and never to submit — filling and submitting
stay in the Node worker where values are decrypted, validated and approval-gated.

Run:  uvicorn main:app --host 0.0.0.0 --port 8088
Pin:  browser-use (see requirements.txt) — its API moves quickly; re-check on upgrade.
"""
import os

from browser_use import Agent, Browser, ChatAnthropic
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="formagent-navigator")

NAV_RULES = """
You are a navigation assistant. Your ONLY job is to reach the page that contains the form described in the goal.
Rules:
- Close cookie banners and pop-ups by choosing the least-permissive option (e.g. "Reject non-essential") when offered.
- Click links/buttons like "Sign up", "Register", "Create account", "Apply", "Get started" to reach the form.
- Do NOT type anything into any field. Do NOT tick checkboxes. Do NOT press any Submit/Register/Pay/Confirm button.
- Stop as soon as the target form is visible on screen and report done.
"""


class NavigateRequest(BaseModel):
    cdp_url: str
    goal: str = Field(max_length=500)
    start_url: str
    max_steps: int = Field(default=12, ge=1, le=25)


class NavigateResponse(BaseModel):
    reached: bool
    finalUrl: str


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/navigate", response_model=NavigateResponse)
async def navigate(req: NavigateRequest) -> NavigateResponse:
    # API key for the sidecar comes from the worker's per-request header in production
    # (org-scoped key); env var here for local development.
    llm = ChatAnthropic(model=os.environ.get("NAVIGATOR_MODEL", "claude-opus-5-5"))
    browser = Browser(cdp_url=req.cdp_url)
    agent = Agent(
        task=f"{NAV_RULES}\nStart URL: {req.start_url}\nGoal: {req.goal}",
        llm=llm,
        browser=browser,
        use_vision=True,
    )
    history = await agent.run(max_steps=req.max_steps)
    urls = [u for u in history.urls() if u]
    return NavigateResponse(reached=bool(history.is_done() and history.is_successful()),
                            finalUrl=urls[-1] if urls else req.start_url)
