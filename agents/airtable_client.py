# airtable_client.py
import requests
from typing import Any, Dict, List, Optional, Tuple
from config import AIRTABLE_API_URL, AIRTABLE_TOKEN, AIRTABLE_BASE_ID

class AirtableClient:
    def __init__(self):
        self.base_id = AIRTABLE_BASE_ID
        self.base_url = f"{AIRTABLE_API_URL}/{self.base_id}"
        self.headers = {
            "Authorization": f"Bearer {AIRTABLE_TOKEN}",
            "Content-Type": "application/json",
        }

    def _handle(self, r: requests.Response) -> Dict[str, Any]:
        try:
            data = r.json()
        except Exception:
            r.raise_for_status()
            return {}
        if not r.ok:
            raise RuntimeError(f"Airtable error {r.status_code}: {data}")
        return data

    def list_records(
        self,
        table: str,
        filter_by_formula: Optional[str] = None,
        max_records: int = 100,
    ) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/{table}"
        params = {"pageSize": 100}
        if filter_by_formula:
            params["filterByFormula"] = filter_by_formula

        out: List[Dict[str, Any]] = []
        offset = None
        while True:
            if offset:
                params["offset"] = offset
            r = requests.get(url, headers=self.headers, params=params, timeout=30)
            data = self._handle(r)
            records = data.get("records", [])
            out.extend(records)
            if len(out) >= max_records:
                return out[:max_records]
            offset = data.get("offset")
            if not offset:
                return out

    def get_one(self, table: str, filter_by_formula: str) -> Optional[Dict[str, Any]]:
        recs = self.list_records(table, filter_by_formula=filter_by_formula, max_records=1)
        return recs[0] if recs else None

    def create_record(self, table: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/{table}"
        r = requests.post(url, headers=self.headers, json={"fields": fields}, timeout=30)
        return self._handle(r)

    def update_record(self, table: str, record_id: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/{table}/{record_id}"
        r = requests.patch(url, headers=self.headers, json={"fields": fields}, timeout=30)
        return self._handle(r)

    def upsert_by_formula(self, table: str, match_formula: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        existing = self.get_one(table, match_formula)
        if existing:
            return self.update_record(table, existing["id"], fields)
        return self.create_record(table, fields)

    # ---------- Linked-record helpers ----------

    def resolve_record_id(self, table: str, id_field: str, id_value: str) -> str:
        """
        Resolve an Airtable record ID (recXXXX) by looking up a human ID field (like batch_id="BATCH001").
        """
        rec = self.get_one(table, f'{{{id_field}}}="{q(id_value)}"')
        if not rec:
            raise RuntimeError(f"Could not resolve record id in {table}: {id_field}={id_value}")
        return rec["id"]

    def resolve_many_record_ids(self, table: str, id_field: str, id_values: List[str]) -> Dict[str, str]:
        """
        Resolve many IDs efficiently (still uses get_one for each; fine for small N markets).
        Returns mapping: id_value -> rec_id
        """
        out = {}
        for v in id_values:
            out[v] = self.resolve_record_id(table, id_field, v)
        return out

def q(s: str) -> str:
    return str(s).replace('"', '\\"')

def make_pair_key(batch_id: str, market_id: str) -> str:
    return f"{batch_id}|{market_id}"
