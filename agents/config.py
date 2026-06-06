# config.py
from dotenv import load_dotenv
load_dotenv()

import os

AIRTABLE_API_URL = os.getenv("AIRTABLE_API_URL", "https://api.airtable.com/v0")
AIRTABLE_TOKEN = os.getenv("AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID")

DATAGOV_API_KEY = os.getenv("DATAGOV_API_KEY")
DATAGOV_RESOURCE_ID = os.getenv("DATAGOV_RESOURCE_ID")

HERE_API_KEY = os.getenv("HERE_API_KEY")
WEATHERAPI_KEY = os.getenv("WEATHERAPI_KEY")

# Table names (must match your Airtable)
T_FARMER_BATCHES = os.getenv("T_FARMER_BATCHES", "Farmer_Batches")
T_HANDLING = os.getenv("T_HANDLING", "Handling_Quality")
T_TRAFFIC = os.getenv("T_TRAFFIC", "Traffic_Estimates")
T_RISK = os.getenv("T_RISK", "Environmental_Risk")
T_MARKETS = os.getenv("T_MARKETS", "Markets")
T_PRICING = os.getenv("T_PRICING", "Market_Pricing")
T_EVAL = os.getenv("T_EVAL", "Market_Evaluation")
T_UNCERTAINTY    = os.getenv("T_UNCERTAINTY", "Uncertainty_Analysis")

def require_env():
    missing = []
    if not AIRTABLE_TOKEN: missing.append("AIRTABLE_TOKEN")
    if not AIRTABLE_BASE_ID: missing.append("AIRTABLE_BASE_ID")
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")
    

