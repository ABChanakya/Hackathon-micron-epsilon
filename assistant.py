import json
import os
from typing import Any, Literal
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_S", "45.0"))

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

_hub_ref: Any = None


def configure_assistant(hub: Any) -> None:
    global _hub_ref
    _hub_ref = hub


def _require_hub() -> Any:
    if _hub_ref is None:
        raise HTTPException(status_code=500, detail="assistant hub is not configured")
    return _hub_ref


async def _call_local_llm(
    system_prompt: str,
    user_prompt: str,
    *,
    json_mode: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if json_mode:
        payload["format"] = "json"

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Local LLM not reachable at {OLLAMA_URL} ({OLLAMA_MODEL}). Start Ollama or set OLLAMA_URL.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Local LLM request failed: {exc}") from exc

    content = ((data.get("message") or {}).get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="Local LLM returned an empty response")
    return {"model": OLLAMA_MODEL, "reply": content}


async def _live_context_snapshot(hub: Any) -> dict[str, Any]:
    state = hub.state()
    frame = hub.last_frame
    settings = None
    try:
        settings = await hub.call("_settings")
    except Exception:
        settings = None

    compact_frame = None
    if isinstance(frame, dict):
        compact_frame = {
            "source": frame.get("source"),
            "unit": frame.get("unit"),
            "value": frame.get("value"),
            "raw_value": frame.get("raw_value"),
            "dist_from_face_mm": frame.get("dist_from_face_mm"),
            "min": frame.get("min"),
            "max": frame.get("max"),
            "mean": frame.get("mean"),
            "n": frame.get("n"),
            "rate_hz": frame.get("rate_hz"),
            "intensity": frame.get("intensity"),
            "errors_in_window": frame.get("errors_in_window"),
            "last_error": frame.get("last_error"),
            "state_flags": frame.get("state_flags"),
            "dropped_total": frame.get("dropped_total"),
            "recording": frame.get("recording"),
        }

    return {
        "status": state.get("status"),
        "source": state.get("source"),
        "info": state.get("info"),
        "recording": state.get("recording"),
        "rec_file": state.get("rec_file"),
        "tare_mm": state.get("tare_mm"),
        "last_error_text": state.get("error"),
        "settings": settings,
        "latest_frame": compact_frame,
    }


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[ChatTurn] = Field(default_factory=list)
    error_context: dict[str, Any] | None = None
    chart_context: dict[str, Any] | None = None


class ExplainErrorRequest(BaseModel):
    error: dict[str, Any] | None = None
    user_question: str | None = None


class ExplainChartRequest(BaseModel):
    seconds: float = Field(default=10.0, ge=0.1, le=300.0)
    bins: int = Field(default=60, ge=10, le=500)
    channel_label: str | None = None
    series: list[dict[str, Any]] | None = None


class ParameterCommandRequest(BaseModel):
    instruction: str = Field(..., min_length=1)
    apply_immediately: bool = False


@router.get("/health")
async def assistant_health():
    hub = _require_hub()
    snap = await _live_context_snapshot(hub)
    reachable = False
    models: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                reachable = True
                models = [m.get("name", "") for m in (r.json().get("models") or []) if m.get("name")]
    except Exception:
        reachable = False

    return {
        "ollama_url": OLLAMA_URL,
        "configured_model": OLLAMA_MODEL,
        "reachable": reachable,
        "available_models": models,
        "sensor_status": snap["status"],
        "sensor_source": snap["source"],
    }


@router.post("/chat")
async def assistant_chat(req: ChatRequest):
    hub = _require_hub()
    ctx = await _live_context_snapshot(hub)

    system_prompt = (
        "Du bist ein hilfreicher technischer Assistent für eine Micro-Epsilon Sensordaten-App "
        "(u. a. optoNCDT 1420 / 1900, thermoMETER UC, Recording, Grenzwerte und Parameter). "
        "Antworte klar, präzise und praxisnah auf Deutsch. "
        "Erfinde keine Messwerte oder Sensor-Eigenschaften, die nicht im Kontext stehen."
    )

    conv_lines = [f"{t.role.upper()}: {t.content}" for t in req.history[-8:]]
    user_prompt = json.dumps(
        {
            "question": req.message,
            "recent_conversation": conv_lines,
            "live_context": ctx,
            "error_context": req.error_context,
            "chart_context": req.chart_context,
        },
        ensure_ascii=False,
        default=str,
    )

    res = await _call_local_llm(system_prompt, user_prompt, json_mode=False)
    return {"reply": res["reply"], "model": res["model"], "context_source": ctx["source"]}


@router.post("/explain-error")
async def explain_error(req: ExplainErrorRequest):
    hub = _require_hub()
    ctx = await _live_context_snapshot(hub)
    target_error = req.error or (ctx.get("latest_frame") or {}).get("last_error") or ctx.get("last_error_text")

    if not target_error:
        raise HTTPException(status_code=400, detail="no error provided and no active sensor error found")

    system_prompt = (
        "Du erklärst Sensor- und Systemfehlermeldungen für Micro-Epsilon Messsysteme auf Deutsch. "
        "Gliedere deine Antwort kurz in: "
        "1) Was ist passiert? (verständlich erklärt) "
        "2) Wahrscheinliche Ursache (z. B. Ziel außer Reichweite, Signalintensität/Reflexion, Parameter/Grenzwert) "
        "3) Nächster Schritt für den Nutzer."
    )

    user_prompt = json.dumps(
        {
            "error": target_error,
            "user_question": req.user_question,
            "sensor_state": {
                "status": ctx["status"],
                "source": ctx["source"],
                "info": ctx["info"],
                "latest_frame": ctx["latest_frame"],
            },
        },
        ensure_ascii=False,
        default=str,
    )

    res = await _call_local_llm(system_prompt, user_prompt, json_mode=False)
    return {"explanation": res["reply"], "error": target_error, "model": res["model"]}


@router.post("/explain-chart")
async def explain_chart(req: ExplainChartRequest):
    hub = _require_hub()
    ctx = await _live_context_snapshot(hub)

    points = req.series
    if points is None:
        try:
            points = await hub.call("_history", req.seconds, req.bins)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"could not load chart history: {exc}") from exc

    if not points:
        raise HTTPException(status_code=400, detail="no chart data available to explain")

    system_prompt = (
        "Du erklärst Messdaten-Graphen und Zeitreihen auf Deutsch für Techniker und Nutzer. "
        "Beschreibe kurz und verständlich: Trend/Verlauf, auffällige Min/Max-Werte oder Sprünge "
        "sowie was das im aktuellen Sensorkontext bedeutet. Nutze nur die gelieferten Daten."
    )

    user_prompt = json.dumps(
        {
            "channel_label": req.channel_label or (ctx.get("info") or {}).get("unit") or "measurement",
            "window_seconds": req.seconds,
            "points_count": len(points),
            "points_sample": points[:120],
            "sensor_context": {
                "source": ctx["source"],
                "info": ctx["info"],
                "tare_mm": ctx["tare_mm"],
                "settings": ctx["settings"],
            },
        },
        ensure_ascii=False,
        default=str,
    )

    res = await _call_local_llm(system_prompt, user_prompt, json_mode=False)
    return {
        "explanation": res["reply"],
        "points_analyzed": len(points),
        "model": res["model"],
    }


@router.post("/parameter-command")
async def parameter_command(req: ParameterCommandRequest):
    hub = _require_hub()
    ctx = await _live_context_snapshot(hub)
    settings = ctx.get("settings") or {}
    allowed_options = settings.get("options") if isinstance(settings, dict) else None

    system_prompt = (
        "Du übersetzt natürlichsprachige Wünsche in einen sicheren Parameter-Änderungsvorschlag "
        "für ein Messsystem. Antworte AUSSCHLIESSLICH als gültiges JSON mit diesem Schema:\n"
        "{\n"
        '  "understood": boolean,\n'
        '  "summary": "kurze Erklärung auf Deutsch",\n'
        '  "proposed_settings": {"rate_khz": number_or_null, "averaging": {"mode": string, "depth": int}_or_null},\n'
        '  "notes_or_warnings": ["..."]\n'
        "}\n"
        "Setze nur Felder in proposed_settings, die ausdrücklich gemeint sind; sonst null."
    )

    user_prompt = json.dumps(
        {
            "instruction": req.instruction,
            "current_settings": {
                k: v for k, v in settings.items() if k not in ("options", "raw")
            } if isinstance(settings, dict) else None,
            "allowed_options": allowed_options,
            "sensor_info": ctx.get("info"),
        },
        ensure_ascii=False,
        default=str,
    )

    raw_res = await _call_local_llm(system_prompt, user_prompt, json_mode=True)
    try:
        parsed = json.loads(raw_res["reply"])
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Local LLM did not return valid JSON: {raw_res['reply'][:300]}",
        ) from exc

    proposed = parsed.get("proposed_settings") or {}
    clean_patch: dict[str, Any] = {}
    if isinstance(proposed, dict):
        if proposed.get("rate_khz") is not None:
            clean_patch["rate_khz"] = proposed["rate_khz"]
        if isinstance(proposed.get("averaging"), dict):
            clean_patch["averaging"] = proposed["averaging"]

    applied_result = None
    if req.apply_immediately and clean_patch:
        try:
            applied_result = await hub.call("_apply", clean_patch)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to apply settings: {exc}") from exc

    return {
        "model": raw_res["model"],
        "understood": bool(parsed.get("understood", bool(clean_patch))),
        "summary": parsed.get("summary", ""),
        "proposed_settings": clean_patch,
        "notes_or_warnings": parsed.get("notes_or_warnings") or [],
        "applied": bool(applied_result is not None),
        "new_settings": applied_result,
    }