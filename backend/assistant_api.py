"""HTTP boundary for the local assistant, independent of sensor/control endpoints."""
import asyncio
from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from assistant import AssistantFailure, AssistantRequest, AssistantService, MAX_BODY_BYTES


class BoundedAssistantRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            if request.method == "POST":
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY_BYTES:
                        raise HTTPException(413, detail={"code": "invalid_request", "message": "Assistant request exceeds 64 KiB."})
                    body.extend(chunk)
                request._body = bytes(body)
            try:
                return await original(request)
            except RequestValidationError as exc:
                raise HTTPException(422, detail={"code": "invalid_request", "message": "Invalid assistant input."}) from exc
            except AssistantFailure as exc:
                raise HTTPException(exc.status, detail={"code": exc.code, "message": exc.message}) from exc
        return handler


def create_assistant_router(service=None):
    service = service or AssistantService()
    router = APIRouter(prefix="/api/assistant", tags=["local assistant"], route_class=BoundedAssistantRoute)

    async def answer(kind, body, request):
        return await answer_until_disconnect(service, kind, body, request)

    @router.get("/status")
    async def status():
        return await service.status()

    @router.post("/chat")
    async def chat(body: AssistantRequest, request: Request):
        return await answer("chat", body, request)

    @router.post("/explain-error")
    async def explain_error(body: AssistantRequest, request: Request):
        return await answer("error", body, request)

    @router.post("/explain-chart")
    async def explain_chart(body: AssistantRequest, request: Request):
        return await answer("chart", body, request)

    @router.post("/command")
    async def command(body: AssistantRequest, request: Request):
        return await answer("command", body, request)

    return router


async def answer_until_disconnect(service, kind, body, request):
    async def disconnected():
        while not await request.is_disconnected():
            await asyncio.sleep(.1)

    work = asyncio.create_task(service.answer(kind, body))
    watch = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait((work, watch), return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return work.result()
        raise AssistantFailure("cancelled", "The assistant request was cancelled by its client.", 499)
    finally:
        for task in (work, watch):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, watch, return_exceptions=True)
