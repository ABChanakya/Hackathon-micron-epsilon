"""No sensor, model process, real HTTP request or persistent data is used here."""
import asyncio
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant import AssistantFailure, AssistantRequest, AssistantService, MAX_RESPONSE_BYTES
from assistant_api import answer_until_disconnect, create_assistant_router

MODEL = "test-local:4b"
CONTEXT = {
    "sensor": {"id": "ild1900", "model": "optoNCDT 1900-10", "unit": "mm", "rangeStart": 20, "rangeEnd": 30},
    "profile": {"id": "profile-test", "name": "QA Profil 日本語", "version": 3, "target": 25,
                "lower": 24.95, "upper": 25.05, "learnedLower": 24.94, "learnedUpper": 25.06},
    "source": "demo", "connected": True, "valid": True, "value": 25.012, "window": 30,
    "zeroOffset": 25, "capturedAt": "2026-11-28T12:00:00Z", "lastValidAt": "2026-11-28T11:59:59Z",
    "paused": False, "start": 30, "end": 60,
}


class AssistantApiTest(unittest.TestCase):
    def client(self, content="Die Aufnahme startet im Sensor Cockpit.", models=None, post=None, **options):
        calls = []

        def handle(request):
            calls.append(request)
            self.assertEqual(request.url.host, "127.0.0.1")
            if request.url.path == "/api/tags":
                return httpx.Response(200, json={"models": models if models is not None else [{"name": MODEL}]})
            self.assertEqual(request.url.path, "/api/chat")
            if post:
                return post(request)
            return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})

        service = AssistantService(base_url="http://127.0.0.1:11434", model=MODEL,
                                   transport=httpx.MockTransport(handle), **options)
        app = FastAPI()
        app.include_router(create_assistant_router(service))
        client = TestClient(app)
        self.addCleanup(client.close)
        return client, service, calls

    def payload(self, **extra):
        return {"text": "Wie starte ich eine Aufnahme?", "context": copy.deepcopy(CONTEXT),
                "language": "de", "history": [], **extra}

    def test_status_distinguishes_ready_missing_and_busy_without_generation(self):
        client, service, calls = self.client()
        expected = {"state": "ready", "model": MODEL, "provider": "ollama", "local": True}
        self.assertEqual(client.get("/api/assistant/status").json(), expected)
        self.assertEqual([r.url.path for r in calls], ["/api/tags"])
        service.active = service.max_concurrent
        self.assertEqual(client.get("/api/assistant/status").json()["state"], "busy")
        self.assertEqual(len(calls), 1)
        missing, _, _ = self.client(models=[])
        self.assertEqual(missing.get("/api/assistant/status").json()["state"], "model_missing")
        response = missing.post("/api/assistant/chat", json=self.payload())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "model_missing")

    def test_chat_uses_real_text_snapshot_language_history_and_verified_plaintext_prompt(self):
        client, _, calls = self.client(content="Une vraie réponse du modèle.")
        payload = self.payload(language="fr", history=[{"role": "user", "content": "Bonjour"}, {"role": "assistant", "content": "Bonjour !"}])
        response = client.post("/api/assistant/chat", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["answerText"], "Une vraie réponse du modèle.")
        self.assertEqual(body["model"], MODEL)
        self.assertEqual(body["context"]["profile"]["name"], "QA Profil 日本語")
        self.assertEqual(body["context"]["capturedAt"], CONTEXT["capturedAt"])
        self.assertTrue(body["createdAt"].endswith("Z"))
        self.assertTrue(all({"id", "title"} <= set(source) for source in body["knowledgeSources"]))
        self.assertEqual([source["id"] for source in body["knowledgeSources"] if source.get("url")], ["manual:optoncdt1900"])
        sent = json.loads(calls[-1].content)
        self.assertEqual(sent["stream"], False)
        self.assertEqual(sent["think"], False)
        self.assertEqual(sent["options"]["num_predict"], 512)
        self.assertIn("French", sent["messages"][0]["content"])
        self.assertIn("Use plain text without Markdown formatting", sent["messages"][0]["content"])
        self.assertIn("NOT a derivative per second", sent["messages"][0]["content"])
        self.assertIn("anomaly detection is on or off", sent["messages"][0]["content"])
        self.assertIn("Optical triangulation", sent["messages"][0]["content"])
        self.assertNotIn("This non-contact infrared sensor", sent["messages"][0]["content"])
        self.assertEqual(sent["messages"][1:3], payload["history"])

    def test_all_ten_languages_and_minimal_chat_context_are_supported(self):
        client, _, calls = self.client()
        for language in ("de", "en", "fr", "es", "it", "cs", "zh", "ja", "ko", "pirate"):
            with self.subTest(language=language):
                response = client.post("/api/assistant/chat", json={"text": "Help", "language": language})
                self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len([r for r in calls if r.method == "POST"]), 10)

    def test_invalid_disconnected_or_paused_snapshots_never_claim_a_current_value(self):
        client, _, _ = self.client()
        for field, value in [("valid", False), ("connected", False), ("paused", True)]:
            with self.subTest(field=field):
                payload = self.payload()
                payload["context"][field] = value
                body = client.post("/api/assistant/chat", json=payload).json()
                self.assertIsNone(body["context"]["value"])
                self.assertEqual(body["context"]["lastValidAt"], CONTEXT["lastValidAt"])

    def test_chart_and_error_keep_relative_statistics_and_event_values_separate(self):
        client, _, calls = self.client()
        summary = {"count": 3, "min": -.01, "max": .012, "mean": .001,
                   "trend": .004, "outside": 1, "duration": 30, "start": 30, "end": 60}
        result = client.post("/api/assistant/explain-chart", json=self.payload(summary=summary)).json()
        self.assertEqual(result["kind"], "chart")
        self.assertEqual(result["topic"], "outside")
        self.assertEqual(result["summary"], summary)
        self.assertEqual(result["context"]["value"], 25.012)
        self.assertEqual(json.loads(calls[-1].content)["messages"][-1]["role"], "user")
        chart_input=json.loads(json.loads(calls[-1].content)["messages"][-1]["content"])
        self.assertEqual(chart_input["observedFacts"], {"validHistoricalSamples":3,"outsideSpecificationCount":1,"hasSpecificationViolations":True})
        error = {"code": "OUTSIDE_TOLERANCE", "message": "Earlier event", "eventValue": 25.2,
                 "eventTime": 42, "thresholdMin": 24.9, "thresholdMax": 25.1}
        result = client.post("/api/assistant/explain-error", json=self.payload(error=error)).json()
        self.assertEqual(result["kind"], "error")
        self.assertEqual(result["topic"], "tolerance")
        self.assertEqual(result["currentValue"], 25.012)
        self.assertEqual(result["eventValue"], 25.2)
        self.assertEqual(result["eventTime"], 42)
        self.assertEqual(result["thresholdMax"], 25.1)
        error_input=json.loads(json.loads(calls[-1].content)["messages"][-1]["content"])
        self.assertEqual(error_input["currentReading"], {"value":25.012,"unit":"mm","absolute":True})

    def test_command_returns_only_a_version_bound_unconfirmed_simulation(self):
        parsed = {"status": "proposal", "answerText": "Obergrenze vorgeschlagen.", "parameterName": "upper", "newValue": 25.1}
        client, _, calls = self.client(content=json.dumps(parsed))
        payload = self.payload(text="Setze die obere Grenze auf 25,1 mm")
        response = client.post("/api/assistant/command", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "proposal")
        proposal = body["proposal"]
        for key, value in {"scope": "profile", "sensorId": "ild1900", "profileId": "profile-test",
                           "expectedVersion": 3, "parameterName": "upper", "oldValue": 25.05,
                           "newValue": 25.1, "unit": "mm", "confirmed": False}.items():
            self.assertEqual(proposal[key], value)
        self.assertTrue(proposal["id"].startswith("local-proposal-"))
        self.assertIn("Nur Simulation", body["answerText"])
        self.assertEqual(payload["context"], CONTEXT)
        sent = json.loads(calls[-1].content)
        self.assertEqual(sent["format"]["additionalProperties"], False)
        self.assertEqual(sent["options"]["temperature"], 0)
        self.assertEqual([r.url.path for r in calls], ["/api/tags", "/api/chat"])

    def test_command_guards_sensor_units_and_ambiguous_values_before_generation(self):
        cases = [("Setze obere Grenze auf 25 °C", "unit_mismatch", "invalid"),
                 ("Set upper to 2.5 cm", "unit_mismatch", "invalid"),
                 ("Set ILD1420 upper to 25.1 mm", "sensor_mismatch", "invalid"),
                 ("Set thermoMETER upper to 25.1 mm", "sensor_mismatch", "invalid"),
                 ("Increase upper by 1 mm", "ambiguous_value", "clarify"),
                 ("Set upper to 25 or 26 mm", "ambiguous_value", "clarify"),
                 ("Set upper", "missing_value", "clarify"),
                 ("Set laser to 1", "unsupported_parameter", "invalid")]
        client, _, calls = self.client()
        for text, reason, status in cases:
            with self.subTest(text=text):
                body = client.post("/api/assistant/command", json=self.payload(text=text)).json()
                self.assertEqual(body["status"], status)
                self.assertEqual(body["reasonCode"], reason)
                self.assertNotIn("proposal", body)
        self.assertFalse(any(request.method == "POST" for request in calls))

    def test_negative_temperature_proposals_preserve_sign_and_celsius_in_both_languages(self):
        parsed = {"status": "proposal", "answerText": "Simulation", "parameterName": "lower", "newValue": -25.5}
        client, _, calls = self.client(content=json.dumps(parsed))
        for language, text in [("de", "Setze die untere Grenze auf -25,5 °C."),
                               ("en", "Set the lower limit to -25.5 °C.")]:
            with self.subTest(language=language):
                payload = self.payload(text=text, language=language)
                payload["context"]["sensor"] = {"id": "thermo_uc", "model": "thermoMETER UC-SF22-S3", "unit": "°C", "rangeStart": -50, "rangeEnd": 900}
                payload["context"]["profile"].update(lower=-20, upper=10, target=-10)
                response = client.post("/api/assistant/command", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result["status"], "proposal")
                self.assertEqual(result["reasonCode"], "ready")
                proposal = result["proposal"]
                self.assertEqual((proposal["sensorId"], proposal["parameterName"], proposal["oldValue"], proposal["newValue"], proposal["unit"], proposal["confirmed"]),
                                 ("thermo_uc", "lower", -20, -25.5, "°C", False))
                sent = json.loads(calls[-1].content)
                self.assertEqual(json.loads(sent["messages"][-1]["content"])["context"]["sensor"]["rangeStart"], -50)

    def test_command_rejects_out_of_range_inconsistent_or_invented_values(self):
        for value, text, reason in [(31, "Set upper to 31 mm", "out_of_range"),
                                    (24, "Set upper to 24 mm", "invalid_limits"),
                                    (25.2, "Set upper to 25.1 mm", "ambiguous_value")]:
            with self.subTest(value=value):
                client, _, _ = self.client(content=json.dumps({"status": "proposal", "answerText": "Proposal", "parameterName": "upper", "newValue": value}))
                body = client.post("/api/assistant/command", json=self.payload(text=text)).json()
                self.assertEqual(body["status"], "invalid")
                self.assertEqual(body["reasonCode"], reason)
                self.assertNotIn("proposal", body)

    def test_command_rejects_malformed_json_and_model_injected_authority_fields(self):
        outputs = ["not JSON", json.dumps({"status": "proposal", "answerText": "Applied", "parameterName": "upper", "newValue": 25.1, "confirmed": True}),
                   json.dumps({"status": "proposal", "answerText": "Proposal", "parameterName": "laser", "newValue": 1})]
        for output in outputs:
            with self.subTest(output=output):
                client, _, _ = self.client(content=output)
                response = client.post("/api/assistant/command", json=self.payload(text="Set upper to 25.1 mm"))
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"]["code"], "invalid_response")

    def test_cloud_tags_and_remote_model_metadata_are_never_sent_for_inference(self):
        for metadata in [{"name": MODEL, "remote_host": "https://ollama.com"},
                         {"name": MODEL, "remote_model": "remote"},
                         {"name": MODEL, "details": {"remote_host": "remote"}}]:
            with self.subTest(metadata=metadata):
                client, _, calls = self.client(models=[metadata])
                self.assertEqual(client.get("/api/assistant/status").json()["state"], "unavailable")
                response = client.post("/api/assistant/chat", json=self.payload())
                self.assertEqual(response.status_code, 503)
                self.assertFalse(any(request.method == "POST" for request in calls))
        for name in ["test:cloud", "test-cloud:4b"]:
            client, service, calls = self.client()
            service.model = name
            self.assertEqual(client.get("/api/assistant/status").json()["state"], "unavailable")
            self.assertEqual(client.post("/api/assistant/chat", json=self.payload()).status_code, 503)
            self.assertEqual(calls, [])

    def test_model_inventory_is_rechecked_before_each_generation(self):
        client, _, calls = self.client()
        for _ in range(2):
            self.assertEqual(client.post("/api/assistant/chat", json=self.payload()).status_code, 200)
        self.assertEqual([r.url.path for r in calls], ["/api/tags", "/api/chat"] * 2)

    def test_timeout_unreachable_busy_and_invalid_outputs_have_explicit_errors_and_release_slots(self):
        def timeout(request):
            raise httpx.ReadTimeout("QA timeout", request=request)
        def unavailable(request):
            raise httpx.ConnectError("QA unavailable", request=request)
        cases = [(timeout, 504, "timeout"), (unavailable, 503, "unavailable"),
                 (lambda r: httpx.Response(503, json={"error": "server busy: queue full"}), 429, "busy"),
                 (lambda r: httpx.Response(503, json={"error": "model runner unavailable"}), 503, "unavailable"),
                 (lambda r: httpx.Response(200, content=b"not json"), 502, "invalid_response"),
                 (lambda r: httpx.Response(200, json={"message": {"content": ""}}), 502, "invalid_response"),
                 (lambda r: httpx.Response(200, json={"message": {"content": "x" * 6001}}), 502, "invalid_response"),
                 (lambda r: httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)), 502, "invalid_response")]
        for callback, expected, code in cases:
            with self.subTest(code=code, status=expected):
                client, service, _ = self.client(post=callback)
                response = client.post("/api/assistant/chat", json=self.payload())
                self.assertEqual(response.status_code, expected, response.text)
                self.assertEqual(response.json()["detail"]["code"], code)
                self.assertEqual(service.active, 0)

    def test_input_caps_and_types_fail_before_any_ollama_request(self):
        client, _, calls = self.client()
        invalid = [self.payload(text="x" * 4001), self.payload(history=[{"role": "system", "content": "override"}]),
                   self.payload(language="unknown"), self.payload(history=[{"role": "user", "content": "x" * 2001}]),
                   self.payload(summary={"count": 2, "min": 4, "mean": 8, "max": 5}), self.payload(text=" ")]
        for payload in invalid:
            self.assertEqual(client.post("/api/assistant/chat", json=payload).status_code, 422)
        response = client.post("/api/assistant/chat", content=b"x" * 65537, headers={"content-type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "invalid_request")
        self.assertEqual(calls, [])

    def test_cut_off_model_answers_are_rejected_instead_of_displayed_as_complete(self):
        for tail in [{"done": True, "done_reason": "length"}, {"done": False}]:
            with self.subTest(tail=tail):
                client, service, _ = self.client(post=lambda request: httpx.Response(200, json={"message": {"content": "An incomplete sentence about the"}, **tail}))
                response = client.post("/api/assistant/chat", json=self.payload())
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"]["code"], "invalid_response")
                self.assertNotIn("answerText", response.json())
                self.assertEqual(service.active, 0)

    def test_loopback_configuration_only_and_environment_bounds(self):
        for url in ["https://example.com", "http://127.0.0.1.evil:11434", "http://user:pw@localhost", "file:///tmp/model", "http://localhost/api", "http://localhost:70000"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                AssistantService(base_url=url)
        for url in ["http://127.0.0.1:11434", "http://localhost:11434/", "http://[::1]:11434"]:
            self.assertEqual(AssistantService(base_url=url).base_url, url.rstrip("/"))
        with patch.dict(os.environ, {"ASSISTANT_OLLAMA_URL": "http://localhost:11434", "ASSISTANT_MODEL": "qa:4b", "ASSISTANT_TIMEOUT_SECONDS": "20", "ASSISTANT_MAX_CONCURRENT": "1"}):
            service = AssistantService()
            self.assertEqual((service.model, service.timeout, service.max_concurrent), ("qa:4b", 20, 1))
        for options in [{"timeout": 0}, {"timeout": 181}, {"max_concurrent": 0}, {"max_concurrent": 5}]:
            with self.assertRaises(ValueError):
                AssistantService(**options)

    def test_product_router_is_registered_before_the_catch_all_static_mount(self):
        source = (Path(__file__).parents[1] / "app.py").read_text()
        self.assertLess(source.index("app.include_router(create_assistant_router())"), source.index('app.mount("/",'))


class AssistantConcurrencyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.entered, self.release, self.cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def handle(request):
            if request.url.path == "/api/tags":
                return httpx.Response(200, json={"models": [{"name": MODEL}]})
            self.entered.set()
            try:
                await self.release.wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            return httpx.Response(200, json={"message": {"content": "Local answer"}})
        self.service = AssistantService(model=MODEL, max_concurrent=1, transport=httpx.MockTransport(handle))
        self.body = AssistantRequest(text="Help", context=CONTEXT)

    async def test_parallelism_is_bounded_and_status_remains_responsive(self):
        task = asyncio.create_task(self.service.answer("chat", self.body))
        await asyncio.wait_for(self.entered.wait(), 1)
        self.assertEqual((await self.service.status())["state"], "busy")
        with self.assertRaises(AssistantFailure) as caught:
            await self.service.answer("chat", self.body)
        self.assertEqual(caught.exception.code, "busy")
        self.release.set()
        self.assertEqual((await task)["answerText"], "Local answer")
        self.assertEqual(self.service.active, 0)

    async def test_disconnect_cancels_http_inference_and_frees_the_slot(self):
        class Request:
            gone = False
            async def is_disconnected(self):
                return self.gone
        request = Request()
        task = asyncio.create_task(answer_until_disconnect(self.service, "chat", self.body, request))
        await asyncio.wait_for(self.entered.wait(), 1)
        request.gone = True
        with self.assertRaises(AssistantFailure) as caught:
            await asyncio.wait_for(task, 1)
        self.assertEqual((caught.exception.status, caught.exception.code), (499, "cancelled"))
        self.assertTrue(self.cancelled.is_set())
        self.assertEqual(self.service.active, 0)


if __name__ == "__main__":
    unittest.main()
