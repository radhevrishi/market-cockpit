// Fixture: IOLCP Q1 FY27 as stored on the live ledger (events + summary),
// read from the 11 Sep 2026 business-update call transcript (NSE/BSE filing
// of 17 Sep 2026), the Aug 2026 investor presentation and the 2026 annual report.
export const IOLCP_EVENTS = [
 {
  "variable": "capacity_addition",
  "value_type": "ACTUAL",
  "before": null,
  "after": "6,000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "First, we are expanding our Ibuprofen capacity by 6,000 MTPA, taking our total capacity to 18,000 MTPA.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "18,000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "First, we are expanding our Ibuprofen capacity by 6,000 MTPA, taking our total capacity to 18,000 MTPA.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "new_plant",
  "value_type": "ACTUAL",
  "before": null,
  "after": "approximately 1,500 million tablets per annum",
  "unit": "tablets per annum",
  "period": null,
  "direction": "up",
  "evidence_text": "Second, we have established a new CDMO facility with a capacity of approximately 1,500 million tablets per annum or equivalent volume of Direct Compressible Grade.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "commissioning",
  "value_type": "GUIDANCE",
  "before": null,
  "after": "December 2027",
  "unit": null,
  "period": null,
  "direction": "unknown",
  "evidence_text": "The new facility will be a fully backward integrated, leveraging one of IOL's key competitive strengths, and is expected to be commissioned by December 2027.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "utilisation",
  "value_type": "GUIDANCE",
  "before": null,
  "after": "90% to 95%",
  "unit": "%",
  "period": null,
  "direction": "unknown",
  "evidence_text": "And additionally, like our current capacity is exhausted up to the level of 90% to 95%.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "utilisation",
  "value_type": "GUIDANCE",
  "before": null,
  "after": "25%",
  "unit": "%",
  "period": "FY28",
  "direction": "up",
  "evidence_text": "But in FY28, I think around 25% utilization we can reach.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capex",
  "value_type": "GUIDANCE",
  "before": null,
  "after": "approximately INR350 crores",
  "unit": "INR",
  "period": null,
  "direction": "unknown",
  "evidence_text": "Firstly, on this Ibuprofen capacity that we're setting up, it's around INR350 crores capex that we are planning, right?",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capex",
  "value_type": "ACTUAL",
  "before": null,
  "after": "approximately INR495 crores",
  "unit": "INR",
  "period": null,
  "direction": "up",
  "evidence_text": "Also, across the three initiatives, approximately INR495 crores of investment is being deployed.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capex",
  "value_type": "ACTUAL",
  "before": null,
  "after": "approximately INR110 crores",
  "unit": "INR",
  "period": null,
  "direction": "up",
  "evidence_text": "From the CDMO perspective, we are investing approximately INR110 crores right now.",
  "source": "Concall transcript Sep 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "10,800 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "Commissioned new Paracetamol Unit-11 with installed capacity of 10,800 MTPA.",
  "source": "Investor presentation Aug 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "1,20,000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "Ethyl Acetate capacity increased to 1,20,000 MTPA Acetic Anhydride capacity increased to 32,000 MTPA.",
  "source": "Investor presentation Aug 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "32,000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "Ethyl Acetate capacity increased to 1,20,000 MTPA Acetic Anhydride capacity increased to 32,000 MTPA.",
  "source": "Investor presentation Aug 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "6000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "Installed Triacetin Capacity of 6000 MTPA",
  "source": "Annual Report 2026",
  "confidence": "LOW",
  "evidence_quality": "chart"
 },
 {
  "variable": "capacity",
  "value_type": "ACTUAL",
  "before": null,
  "after": "120,000 MTPA",
  "unit": "MTPA",
  "period": null,
  "direction": "up",
  "evidence_text": "During the year, we successfully expanded Ethyl Acetate capacity to 120,000 MTPA and enhanced Acetic Anhydride capacity to 32,000 MTPA.",
  "source": "Annual Report 2026",
  "confidence": "HIGH",
  "evidence_quality": "sentence"
 }
] as any[];

export const IOLCP_SUMMARY: any = {
 "guidance": {
  "action": "maintained",
  "detail": "Revenue Growth 15%-20%. EBITDA Margin 14%-15%. Exports Contribution 25%-30%. Capex 200-250 Crs.",
  "period": "FY26-27"
 },
 "capital": {
  "capex": "Proposed investment approximately INR500 crores across three initiatives; company guidance FY27 capex 200-250 Crs; 30% of overall funding already incurred.",
  "buyback": "",
  "dividend": "",
  "debt": "Company near debt-free; debt equity ratio 0.08; capex to be funded through internal accruals."
 },
 "utilisation": {
  "current": "",
  "prior": "existing Ibuprofen facilities operating at high utilisation (90%-95% stated).",
  "expected": "Ibuprofen 25% in FY28 initially, optimal >80% by FY28-29; CDMO optimal in 18-24 months.",
  "expected_by": "FY28-FY29 and 18-24 months respectively",
  "basis": "company statements on utilisation targets"
 },
 "capex_projects": [
  {
   "name": "Ibuprofen expansion",
   "type": "brownfield",
   "amount": "around INR350 crores (mentioned in Q&A)",
   "capacity_added": "6,000 MTPA",
   "status": "under_construction",
   "completion_period": "commission by December 2027",
   "revenue_from": "not stated"
  },
  {
   "name": "CDMO formulations facility",
   "type": "brownfield",
   "amount": "approximately INR110 crores (mentioned in Q&A)",
   "capacity_added": "1,500 million tablets per annum",
   "status": "commissioned",
   "completion_period": "commercialization expected Q3 FY27",
   "revenue_from": "not stated"
  },
  {
   "name": "Specialty chemical tolling facility",
   "type": "not_stated",
   "amount": "",
   "capacity_added": "",
   "status": "announced",
   "completion_period": "not stated",
   "revenue_from": "not stated"
  }
 ],
 "capex_earning": "Around 30% of the INR500 crore investment already incurred; management says investments are planned to be funded through internal accruals and will contribute incremental 25%-30% to topline over coming years but does not tie spend to specific revenue timelines beyond general commissioning dates.",
 "capacity": {
  "installed": "API total installed capacity 30,726 MTPA; total installed capacity 2,13,126 MTPA (presentation figures).",
  "prior_installed": "",
  "added": "Ibuprofen +6,000 MTPA",
  "added_by": "December 2027",
  "new_plant": "CDMO formulations facility, Ibuprofen expansion, specialty chemical facility",
  "new_plant_location": "existing site and 101-acre newly purchased land for future expansion (Chandigarh-Bathinda Highway mentioned elsewhere).",
  "commissioning": "Ibuprofen by December 2027; CDMO commercialization Q3 FY27",
  "bottleneck": "Existing Ibuprofen facilities operating at 90%-95% utilisation (implying capacity constraint)."
 },
 "demand": {
  "order_intake": "",
  "order_intake_growth": "",
  "cancellations": "",
  "revenue_visibility": "Management says projects are customer-led with anchor commitments; collectively expected to contribute incremental 25%-30% to topline over coming years."
 },
 "volume_price_mix": {
  "volume": "",
  "price": "",
  "mix": "Company cites higher non-Ibuprofen share (37%) and forward integration into formulations; no numerical mix effect on margin provided.",
  "exports": "Exports target 25%-30% per guidance"
 },
 "risks": {
  "supply_bottleneck": "No new bottleneck disclosed; existing Ibuprofen units at 90%-95% utilisation.",
  "delay": "",
  "shutdown": "",
  "market_share": "",
  "pricing_power": "Management states price adjustment clauses exist in contracts to pass through input cost fluctuations.",
  "technology": "",
  "raw_materials": "Management noted Paracetamol and other API prices have softened from peaks; no sustained raw-material tailwind quantified."
 },
 "management_targets": [
  {
   "metric": "Exports Contribution",
   "target": "25%-30%",
   "by": "FY26-27 guidance period"
  },
  {
   "metric": "EBITDA Margin",
   "target": "14%-15%",
   "by": "FY26-27 guidance period"
  }
 ],
 "margin_bridge": {
  "opm_change_pp": "",
  "drivers": [],
  "verdict": "not_explained",
  "where_in_pnl": "no_divergence"
 },
 "new_business": [
  "6,000 MTPA Ibuprofen expansion to take total Ibuprofen capacity to 18,000 MTPA (commission by December 2027).",
  "CDMO formulations facility ~1,500 million tablets per annum (EU GMP certified; commercialization expected Q3 FY27).",
  "Specialty chemical dedicated tolling facility under long-term tolling arrangement with a global chemical company (customer-led)."
 ],
 "catalysts": [
  {
   "title": "CDMO formulations facility (1,500 million tablets per annum)",
   "category": "product",
   "status": "commissioned",
   "size_vs_company": "not quantified",
   "expected_impact_period": "commercialization expected during Q3 FY27",
   "evidence_quote": "we have established a new CDMO facility with a capacity of approximately 1,500 million tablets per annum... The facility has received the EU GMP certification, and commercialization is expected during Q3 FY27."
  }
 ],
 "customers": {
  "approval": "EU GMP for CDMO."
 }
};
