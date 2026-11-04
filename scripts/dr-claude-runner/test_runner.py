"""runner.py 的測試（不用裝 SDK、不打 API）：python3 -m unittest scripts/dr-claude-runner/test_runner.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runner  # noqa: E402

CTX = {
    "job": {"id": 7, "kind": "chat", "memberId": 1, "createdBy": "dad@test.com", "attachmentIds": [5]},
    "today": "2026-11-04",
    "now": "2026-11-04 13:20:00",
    "asker": {"email": "dad@test.com", "name": "Nathan", "memberId": 1},
    "members": [
        {"id": 1, "name": "Nathan", "relation": "本人", "ageText": "41 歲", "sex": "M", "latestWeightKg": None, "allergies": "", "conditions": "三年前肺炎鏈球菌住院", "note": ""},
        {"id": 2, "name": "蓉蓉", "relation": "女兒", "ageText": "5 歲 4 個月", "sex": "F", "latestWeightKg": 18.2, "allergies": "無", "conditions": "", "note": ""},
    ],
    "conversation": {"id": 3, "memberId": 1, "messages": [
        {"role": "user", "body": "這是什麼藥？", "createdAt": "2026-11-04 13:18:00", "attachmentIds": [5]},
    ]},
    "activeMedications": [
        {"id": 1, "memberId": 1, "name": "CEPHALEXIN 500MG", "genericName": "Cephalexin", "category": "抗生素", "dose": "1 顆", "slots": ["morning", "noon", "evening"],
         "schedule": "一天 3 次・三餐飯後", "startDate": "2026-11-03", "days": 3, "progress": "第 2/3 天", "mustFinish": True, "cautions": ""},
    ],
    "recentVisits": [{"visitDate": "2026-11-03", "memberId": 1, "clinic": "聖青診所", "department": "", "doctor": "", "reason": "黃鼻涕", "diagnosis": "", "advice": "", "followUpDate": None}],
    "recentNotes": [{"notedAt": "2026-11-04 13:18", "memberId": 1, "body": "頭昏"}],
    "recentMeasurements": [{"measuredAt": "2026-11-04 13:20", "memberId": 1, "kind": "temperature", "value": 37.6, "value2": None}],
    "attachments": [{"id": 5, "contentType": "image/jpeg"}],
}


class PromptTest(unittest.TestCase):
    def test_context_has_family_meds_and_history(self):
        text = runner.build_context_text(CTX)
        self.assertIn("#2 蓉蓉、女兒、5 歲 4 個月、女、最近體重 18.2 kg", text)
        self.assertIn("病史：三年前肺炎鏈球菌住院", text)
        self.assertIn("CEPHALEXIN 500MG（Cephalexin） 抗生素 1 顆，一天 3 次・三餐飯後，2026-11-03 起 3 天；第 2/3 天；要吃完", text)
        self.assertIn("體溫 °C 37.6", text)
        self.assertIn("問的人：Nathan（就是家人 Nathan）", text)

    def test_chat_prompt_points_to_attachment(self):
        prompt = runner.build_prompt(CTX, {5: Path("/tmp/job/file-5.jpg")})
        self.assertIn("家人：這是什麼藥？（附圖：/tmp/job/file-5.jpg，用 Read 看）", prompt)

    def test_scan_prompt(self):
        ctx = {**CTX, "job": {**CTX["job"], "kind": "rx_scan"}, "conversation": None}
        prompt = runner.build_prompt(ctx, {5: Path("/tmp/job/file-5.jpg")})
        self.assertIn("這是 Nathan 的藥袋", prompt)
        self.assertIn("115.11.03 → 2026-11-03", prompt)


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.c = runner.Collector({1, 2})

    def test_note_and_measurement(self):
        self.c.add_note({"memberId": 1, "body": "尿尿灼熱", "severity": 5})
        self.c.add_measurement({"memberId": 1, "kind": "temperature", "value": 37.6})
        self.assertEqual(self.c.actions[0]["severity"], 3)
        self.assertIsNone(self.c.actions[1]["value2"])

    def test_rejects_unknown_member_and_kind(self):
        with self.assertRaises(ValueError):
            self.c.add_note({"memberId": 9, "body": "x"})
        with self.assertRaises(ValueError):
            self.c.add_measurement({"memberId": 1, "kind": "bmi", "value": 1})
        with self.assertRaises(ValueError):
            self.c.set_mood({"mood": "angry"})

    def test_draft_keeps_known_fields_only(self):
        self.c.propose_visit({"memberId": 2, "draft_json": json.dumps({
            "visitDate": "2026-11-03", "clinic": "小兒科", "hack": "x",
            "medications": [{"name": "退燒藥水", "slots": ["morning", "midnight"], "evil": 1}, {"name": ""}],
        })})
        draft = self.c.actions[0]["draft"]
        self.assertNotIn("hack", draft)
        self.assertEqual(draft["medications"], [{"name": "退燒藥水", "slots": ["morning"]}])
        with self.assertRaises(ValueError):
            runner.parse_draft("{}")


class OptionsTest(unittest.TestCase):
    def test_chat_tools_are_locked_down(self):
        opts = runner.agent_options({"FD_ANTHROPIC_API_KEY": "k"}, "chat", Path("/tmp/x"))
        self.assertEqual(opts["model"], "claude-sonnet-5-5")
        self.assertEqual(opts["setting_sources"], [])
        self.assertNotIn("Bash", opts["allowed_tools"])
        self.assertNotIn("WebFetch", opts["allowed_tools"])
        self.assertIn("mcp__fd__record_health_note", opts["allowed_tools"])
        self.assertEqual(opts["permission_mode"], "dontAsk")

    def test_scan_uses_scan_model(self):
        opts = runner.agent_options({"FD_ANTHROPIC_API_KEY": "k"}, "rx_scan", Path("/tmp/x"))
        self.assertEqual(opts["model"], "claude-opus-5-5")
        self.assertEqual(opts["allowed_tools"], ["Read", "mcp__fd__set_mood", "mcp__fd__submit_draft"])


class ConfigTest(unittest.TestCase):
    def test_load(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "env"
            p.write_text("# x\nFD_ANTHROPIC_API_KEY='k'\nFD_AGENT_CLIENT_ID=a.access\nFD_AGENT_CLIENT_SECRET=s\n")
            p.chmod(0o600)
            cfg = runner.load_config(p)
            self.assertEqual(cfg["FD_ANTHROPIC_API_KEY"], "k")


class FakePlatform:
    def __init__(self, complete_status=200):
        self.calls = []
        self.complete_status = complete_status

    def context(self, job_id):
        return CTX

    def download(self, job_id, aid):
        return b"\xff\xd8\xff"

    def progress(self, job_id, stage):
        self.calls.append(("progress", stage))

    def complete(self, job_id, payload):
        self.calls.append(("complete", payload))
        if self.complete_status != 200 and payload["actions"]:
            return self.complete_status, {"error": "量測不合理"}
        return 200, {"ok": True}

    def fail(self, job_id, msg):
        self.calls.append(("fail", msg))


class HandleTest(unittest.TestCase):
    def run_with(self, platform, collector, result):
        async def fake_agent(cfg, plat, ctx, files, job_dir):
            self.assertTrue(files[5].exists())
            self.job_dir = job_dir
            return collector, result

        orig = runner.run_agent
        runner.run_agent = fake_agent
        try:
            return runner.handle({"FD_ANTHROPIC_API_KEY": "k"}, platform, {"id": 7, "kind": "chat"})
        finally:
            runner.run_agent = orig

    def test_success_sends_reply_and_actions_and_cleans_up(self):
        c = runner.Collector({1, 2})
        c.set_mood({"mood": "concerned"})
        c.add_note({"memberId": 1, "body": "尿尿灼熱"})
        p = FakePlatform()
        out = self.run_with(p, c, {"subtype": "success", "cost": 0.012, "text": "建議回診驗尿。"})
        self.assertIn("完成", out)
        payload = [x for x in p.calls if x[0] == "complete"][0][1]
        self.assertEqual(payload["mood"], "concerned")
        self.assertEqual(len(payload["actions"]), 1)
        self.assertFalse(self.job_dir.exists())

    def test_server_rejects_actions_reply_still_delivered(self):
        c = runner.Collector({1, 2})
        c.add_measurement({"memberId": 1, "kind": "temperature", "value": 99})
        p = FakePlatform(complete_status=400)
        out = self.run_with(p, c, {"subtype": "success", "cost": 0.01, "text": "記好了"})
        self.assertIn("紀錄沒存", out)
        last = [x for x in p.calls if x[0] == "complete"][-1][1]
        self.assertEqual(last["actions"], [])
        self.assertIn("沒存成功", last["reply"])

    def test_budget_exceeded_fails(self):
        p = FakePlatform()
        out = self.run_with(p, runner.Collector({1}), {"subtype": "error_max_budget_usd", "cost": 1.5, "text": ""})
        self.assertIn("花費到上限", out)
        self.assertEqual(p.calls[-1][0], "fail")


if __name__ == "__main__":
    unittest.main()
