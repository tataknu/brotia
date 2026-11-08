"""Pydantic v2 mirror of contracts/v1/types.ts (NORMATIVE; see CONTRACT.md §A).

Conventions
- Python attributes are snake_case; JSON is camelCase via `camel()` (populate_by_name=True, so both
  spellings validate). Serialise with `model.model_dump(by_alias=True, mode="json")` or `dump(model)`.
- We do NOT use pydantic's `to_camel`: it mangles names with digits (eto7d_mm -> 'eto7DMm',
  harvest_rain_mm72h -> 'harvestRainMm72H'). `camel()` only upper-cases the first letter of each
  later segment, which yields exactly the contract names ('eto7dMm', 'harvestRainMm72h').
- Optional fields default to None and are emitted as null (CONTRACT §0: emit null rather than omit).
- Unknown extra keys are ignored (forward compatibility).
- Enum values are snake_case strings exactly as in types.ts.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, TypeAdapter, model_serializer

CONTRACT_VERSION = 1


def camel(name: str) -> str:
    """snake_case -> camelCase, preserving the case of every char after the first of a segment."""
    head, *rest = name.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest if p)


class CLMModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=camel,
        populate_by_name=True,
        extra="ignore",
        protected_namespaces=(),
    )

    def to_json_dict(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


def dump(obj: Any) -> Any:
    """Serialise a model, a list of models, or plain data to JSON-ready camelCase data."""
    if isinstance(obj, BaseModel):
        return obj.model_dump(by_alias=True, mode="json")
    if isinstance(obj, (list, tuple)):
        return [dump(x) for x in obj]
    if isinstance(obj, dict):
        return {k: dump(v) for k, v in obj.items()}
    return obj


# ───────────────────────────── Enumerations ─────────────────────────────

Crop = Literal["cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape"]
CROPS: list[str] = ["cherry", "blueberry", "avocado", "walnut", "hazelnut", "table_grape"]

Peril = Literal[
    "frost",
    "heat",
    "harvest_rain",
    "water",
    "chill",
    "fire",
    "flood",
    "declared_emergency",
    "abandonment",
    "vigour",
]
PERILS: list[str] = [
    "frost",
    "heat",
    "harvest_rain",
    "water",
    "chill",
    "fire",
    "flood",
    "declared_emergency",
    "abandonment",
    "vigour",
]
CLIMATE_PERILS: list[str] = ["frost", "heat", "harvest_rain", "water", "chill", "vigour", "abandonment"]
DISASTER_PERILS: list[str] = ["fire", "flood", "declared_emergency"]

Tier = Literal["normal", "watch", "high"]
TIERS: list[str] = ["normal", "watch", "high"]

DataTier = Literal["enhanced", "standard"]
LicenceTier = Literal["commercial_ok", "demo_only", "unresolved"]
Currency = Literal["USD", "CLP"]

Scalar = Union[bool, int, float, str]

# ───────────────────────────── Provenance ─────────────────────────────


class Provenance(CLMModel):
    source: str
    source_label: str
    observed_at: str | None = None
    fetched_at: str
    resolution: str
    licence_tier: LicenceTier
    data_tier: DataTier
    stale: bool = False
    estimated: bool = False
    note: str | None = None


# ───────────────────────────── GeoJSON ─────────────────────────────


class Polygon(CLMModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


class Geometry(CLMModel):
    """Any GeoJSON geometry (loose: type + coordinates/geometries)."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    type: str
    coordinates: Any = None


# ───────────────────────────── Countries ─────────────────────────────


class Country(CLMModel):
    code: str
    name: str
    name_es: str
    data_tier: DataTier
    coming_later: bool
    center: tuple[float, float]
    zoom: float
    default_currency: Currency


# ───────────────────────────── Crop templates ─────────────────────────────


class Labels(CLMModel):
    es: str
    en: str


class Stage(CLMModel):
    key: str
    label: str
    label_es: str
    start: str
    end: str
    sensitivity: dict[Peril, float]


class StageThresholds(CLMModel):
    frost_critical_c: float
    frost_severe_c: float
    heat_c: float
    harvest_rain_mm72h: float
    kc: float


class AgronomicRules(CLMModel):
    stages: dict[str, StageThresholds]
    chill_hours_min: float
    baseline_years: int


class RiskWeights(CLMModel):
    a: float
    b: float
    c: float


CreditAction = Literal["watch", "high", "field_visit", "restructure_review"]
CreditMetric = Literal[
    "risk.tier",
    "risk.score",
    "water.decreeActive",
    "water.snowmeltPct",
    "water.stressLevel",
    "imagery.abandonment",
    "events.burnedAreaIntersects",
]
CreditOp = Literal["eq", "neq", "gt", "gte", "lt", "lte"]


class CreditCondition(CLMModel):
    metric: CreditMetric
    op: CreditOp
    value: Scalar
    within_days_before_installment: int | None = None


class CreditWhen(CreditCondition):
    """`CreditCondition & { and?: CreditCondition[] | null }`. `and` is a Python keyword."""

    and_: list[CreditCondition] | None = Field(default=None, alias="and")


class CreditRule(CLMModel):
    id: str
    name: str
    enabled: bool
    when: CreditWhen
    then: CreditAction
    message: str


class CropTemplate(CLMModel):
    crop: Crop
    labels: Labels
    ciren_especie: list[str]
    evergreen: bool
    covered_default: bool
    cover_likelihood: Literal["rarely", "sometimes", "often"]
    color: str
    stages: list[Stage]
    rules: AgronomicRules
    weights: RiskWeights
    credit_rules: list[CreditRule]
    sources: list[str]
    approximate: bool


# ───────────────────────────── Overrides (layering) ─────────────────────────────


class PatchModel(CLMModel):
    """Override-layer models (Partial<...> in types.ts). Unset leaves are OMITTED when serialised,
    not emitted as null: several of these TS leaves are `x?: T` without `| null`, and the app's
    "Custom" badges read leaf presence."""

    @model_serializer(mode="wrap")
    def _drop_unset(self, handler: SerializerFunctionWrapHandler) -> Any:
        data = handler(self)
        return {k: v for k, v in data.items() if v is not None} if isinstance(data, dict) else data


class StagePatch(PatchModel):
    start: str | None = None
    end: str | None = None
    sensitivity: dict[Peril, float] | None = None


class StageThresholdsPatch(PatchModel):
    frost_critical_c: float | None = None
    frost_severe_c: float | None = None
    heat_c: float | None = None
    harvest_rain_mm72h: float | None = None
    kc: float | None = None


class RulesPatchRules(PatchModel):
    stages: dict[str, StageThresholdsPatch] | None = None
    chill_hours_min: float | None = None
    baseline_years: int | None = None


class RiskWeightsPatch(PatchModel):
    a: float | None = None
    b: float | None = None
    c: float | None = None


class RulesPatch(PatchModel):
    stages: dict[str, StagePatch] | None = None
    rules: RulesPatchRules | None = None
    weights: RiskWeightsPatch | None = None


ZoneOverrides = dict[Crop, RulesPatch]


class CreditWhenPatch(PatchModel):
    metric: CreditMetric | None = None
    op: CreditOp | None = None
    value: Scalar | None = None
    within_days_before_installment: int | None = None
    and_: list[CreditCondition] | None = Field(default=None, alias="and")


class CreditRuleOverride(PatchModel):
    enabled: bool | None = None
    when: CreditWhenPatch | None = None
    then: CreditAction | None = None
    message: str | None = None


CreditRuleOverrides = dict[str, CreditRuleOverride]

# ───────────────────────────── Portfolio ─────────────────────────────


class Zone(CLMModel):
    id: str
    name: str
    center: tuple[float, float]
    radius_m: float = 3338
    auto: bool
    overrides: dict[Crop, RulesPatch] = Field(default_factory=dict)
    color: str | None = None


ScheduleType = Literal["bullet", "monthly", "quarterly", "semiannual", "at_harvest", "custom"]


class Installment(CLMModel):
    due_date: str
    amount: float


class Loan(CLMModel):
    origination_date: str
    maturity_date: str
    amount: float
    currency: Currency
    schedule_type: ScheduleType
    installments: list[Installment] = Field(default_factory=list)


class CirenRef(CLMModel):
    especie: str
    variedad: str | None = None
    source_layer: str
    object_id: int


class Farm(CLMModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    crop: Crop
    polygon: Polygon
    area_ha: float
    centroid: tuple[float, float]
    zone_id: str
    covered: bool | None = None
    irrigated_declared: bool | None = None
    planting_year: int | None = None
    ciren: CirenRef | None = None
    overrides: RulesPatch = Field(default_factory=RulesPatch)
    credit_rule_overrides: dict[str, CreditRuleOverride] = Field(default_factory=dict)
    loan: Loan | None = None


class Actor(CLMModel):
    kind: Literal["user", "agent"]
    name: str


class ChangeScope(CLMModel):
    level: Literal["crop", "zone", "farm", "portfolio"]
    id: str


class RuleChange(CLMModel):
    id: str
    at: str
    actor: Actor
    scope: ChangeScope
    path: str
    old_value: Any = None
    new_value: Any = None
    reason: str
    status: Literal["applied", "proposed", "dismissed"]
    recommendation_id: str | None = None


class Portfolio(CLMModel):
    schema_version: Literal[1] = 1
    id: str
    name: str
    #: v1.1 (ADR-0026 D6): short fund/book code shown in mono beside the name, e.g. 'CLSF1'. Optional.
    code: str | None = None
    lender: str
    country: str
    currency: Currency
    created_at: str
    zones: list[Zone] = Field(default_factory=list)
    farms: list[Farm] = Field(default_factory=list)
    credit_rules: list[CreditRule] = Field(default_factory=list)
    crop_overrides: dict[Crop, RulesPatch] = Field(default_factory=dict)
    audit: list[RuleChange] = Field(default_factory=list)

    def farm(self, farm_id: str) -> Farm | None:
        return next((f for f in self.farms if f.id == farm_id), None)

    def zone(self, zone_id: str) -> Zone | None:
        return next((z for z in self.zones if z.id == zone_id), None)


# ───────────────────────────── Series ─────────────────────────────

SeriesVariable = Literal["ndvi", "ndmi", "precip", "tmin", "tmax", "eto"]
SERIES_VARIABLES: list[str] = ["ndvi", "ndmi", "precip", "tmin", "tmax", "eto"]
SERIES_UNITS: dict[str, str] = {
    "ndvi": "index",
    "ndmi": "index",
    "precip": "mm",
    "eto": "mm",
    "tmin": "°C",
    "tmax": "°C",
}


class SeriesPoint(CLMModel):
    date: str
    value: float | None = None
    p10: float | None = None
    p50: float | None = None
    p90: float | None = None
    estimated: bool | None = None


class Series(CLMModel):
    variable: SeriesVariable
    unit: str
    points: list[SeriesPoint] = Field(default_factory=list)
    provenance: Provenance


# ───────────────────────────── Risk ─────────────────────────────

ComponentKey = Literal["climate", "disaster", "geography"]


class Driver(CLMModel):
    component: ComponentKey
    peril: Peril
    metric: str
    severity: float
    sensitivity: float | None = None
    impact: float
    text: str
    value: Scalar | None = None
    normal: Scalar | None = None
    unit: str | None = None
    provenance: Provenance


class RiskComponent(CLMModel):
    key: ComponentKey
    value: float
    drivers: list[Driver] = Field(default_factory=list)


class FiredCreditAction(CLMModel):
    rule_id: str
    action: CreditAction
    message: str


class StageRef(CLMModel):
    key: str
    label: str


class RiskComponents(CLMModel):
    climate: RiskComponent
    disaster: RiskComponent
    geography: RiskComponent


class Risk(CLMModel):
    score: float
    score_tier: Tier
    tier: Tier
    stage: StageRef
    components: RiskComponents
    weights: RiskWeights
    formula: str
    headline: str
    drivers: list[Driver] = Field(default_factory=list)
    credit_actions: list[FiredCreditAction] = Field(default_factory=list)


# ───────────────────────────── Water status (ladder) ─────────────────────────────

StressLevel = Literal["none", "mild", "moderate", "severe", "unknown"]


class WaterIrrigated(CLMModel):
    value: Literal["yes", "no", "unknown"]
    evidence: str
    provenance: Provenance


class WaterDemand(CLMModel):
    kc: float
    eto7d_mm: float | None = None
    need7d_mm: float | None = None
    need30d_mm: float | None = None
    provenance: Provenance


class WaterSupply(CLMModel):
    decree_active: bool
    decree_id: str | None = None
    decree_until: str | None = None
    snowmelt_pct_of_normal: float | None = None
    basin: str | None = None
    provenance: Provenance


class WaterStress(CLMModel):
    ndmi_z: float | None = None
    ndmi_peer_delta: float | None = None
    canopy_minus_air_c: float | None = None
    level: StressLevel
    provenance: Provenance


class WaterAbandonment(CLMModel):
    flag: bool
    confidence: Literal["low", "medium", "high"]
    evidence: str
    provenance: Provenance


class WaterStatus(CLMModel):
    irrigated: WaterIrrigated
    demand: WaterDemand
    supply: WaterSupply
    stress: WaterStress
    abandonment: WaterAbandonment


# ───────────────────────────── Peers ─────────────────────────────


class PeerComparison(CLMModel):
    zone_id: str
    n_peers: int
    farm_ndvi_z: float | None = None
    peer_median_ndvi_z: float | None = None
    farm_ndmi_z: float | None = None
    peer_median_ndmi_z: float | None = None
    reading: Literal["zone_wide", "farm_specific", "normal", "insufficient_peers"]
    provenance: Provenance


# ───────────────────────────── Imagery ─────────────────────────────


class ImageryUrls(CLMModel):
    ndvi: str
    rgb: str | None = None
    ndvi_sr: str | None = None
    rgb_sr: str | None = None


class ImageryFrame(CLMModel):
    date: str
    kind: Literal["observed", "interpolated"]
    days_to_clear: int
    clear_fraction: float | None = None
    ndvi_mean: float
    ndvi_p10: float
    ndvi_p90: float
    urls: ImageryUrls
    sr_kind: Literal["ai", "resampled"] | None = None
    sr_model: str | None = None


class ImageryLegend(CLMModel):
    min: float
    max: float
    colormap: str
    stops: list[tuple[float, str]]


class ImageryTimeline(CLMModel):
    farm_id: str
    bbox: tuple[float, float, float, float]
    crs: Literal["EPSG:4326"] = "EPSG:4326"
    native_resolution_m: float
    sr_resolution_m: float | None = None
    frames: list[ImageryFrame] = Field(default_factory=list)
    legend: ImageryLegend
    covered_warning: str | None = None
    trust_note: str
    provenance: Provenance


# ───────────────────────────── Events ─────────────────────────────


class ClimateEvent(CLMModel):
    id: str
    kind: Peril
    title: str
    region: str
    start: str
    end: str | None = None
    severity: Literal["moderate", "severe", "extreme"]
    source: str
    evidence_kind: Literal["observed_footprint", "official_declaration", "own_signal", "narrative"]
    geometry: dict[str, Any] | None = None
    affected_farm_ids: list[str] = Field(default_factory=list)
    affected_exposure: float = 0
    provenance: Provenance


# ───────────────────────────── Assessments ─────────────────────────────


class StageBand(CLMModel):
    stage: str
    label: str
    start: str
    end: str


class FarmAssessment(CLMModel):
    farm_id: str
    as_of: str
    zone_id: str
    data_tier: DataTier
    risk: Risk
    water: WaterStatus
    peers: PeerComparison
    series: dict[SeriesVariable, Series]
    next_installment: Installment | None = None
    exposure: float
    stage_bands: list[StageBand] = Field(default_factory=list)
    data_as_of: dict[str, str | None] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class RankedFarm(CLMModel):
    farm_id: str
    name: str
    crop: Crop
    zone_id: str
    score: float
    tier: Tier
    exposure: float
    headline: str
    stage: StageRef
    next_installment: Installment | None = None


class ExposureSlice(CLMModel):
    farms: int
    exposure: float
    stressed_exposure: float


class CropExposureSlice(ExposureSlice):
    crop: Crop


class ZoneExposureSlice(ExposureSlice):
    zone_id: str


class FarmCreditAction(FiredCreditAction):
    farm_id: str


class PortfolioAssessment(CLMModel):
    portfolio_id: str
    as_of: str
    currency: Currency
    total_exposure: float
    exposure_by_tier: dict[Tier, float]
    farms_by_tier: dict[Tier, int]
    ranked: list[RankedFarm] = Field(default_factory=list)
    by_crop: list[CropExposureSlice] = Field(default_factory=list)
    by_zone: list[ZoneExposureSlice] = Field(default_factory=list)
    events: list[ClimateEvent] = Field(default_factory=list)
    credit_actions: list[FarmCreditAction] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# ───────────────────────────── Agent ─────────────────────────────


class AgentEvidence(CLMModel):
    kind: Literal["backtest", "history", "event"]
    summary: str
    data: Any = None


class AgentToolCall(CLMModel):
    name: str
    input: Any = None
    output_summary: str


class AgentRecommendation(CLMModel):
    id: str
    zone_id: str | None = None
    farm_id: str | None = None
    question: str
    answer: str
    proposals: list[RuleChange] = Field(default_factory=list)
    evidence: list[AgentEvidence] = Field(default_factory=list)
    tool_calls: list[AgentToolCall] = Field(default_factory=list)
    model: str
    created_at: str


# ───────────────────────────── API envelopes ─────────────────────────────

ApiErrorCode = Literal["invalid_request", "bbox_too_large", "not_found", "no_api_key", "internal_error"]


class ApiError(CLMModel):
    error: str
    detail: str


class HealthSource(CLMModel):
    source: str
    ok: bool
    last_fetched_at: str | None = None
    stale: bool


class Health(CLMModel):
    status: Literal["ok"] = "ok"
    contract_version: Literal[1] = 1
    service_version: str
    time: str
    agent_available: bool
    sr_mode: Literal["ai", "resampled"]
    sr_model: str | None = None
    sources: list[HealthSource] = Field(default_factory=list)


class CirenOrchardProperties(CLMModel):
    object_id: int
    especie: str
    crop: Crop | None = None
    area_ha: float | None = None
    comuna: str | None = None
    source_layer: str


class CirenOrchardFeature(CLMModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: Polygon
    properties: CirenOrchardProperties


class CirenOrchardCollection(CLMModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[CirenOrchardFeature] = Field(default_factory=list)
    truncated: bool = False
    provenance: Provenance


class AssessPortfolioRequest(CLMModel):
    portfolio: Portfolio
    as_of: str | None = None


class AssessFarmRequest(CLMModel):
    portfolio: Portfolio
    farm_id: str
    as_of: str | None = None


class ImageryRequest(CLMModel):
    portfolio: Portfolio
    farm_id: str
    sr: bool | None = True
    as_of: str | None = None


class AgentRequest(CLMModel):
    portfolio: Portfolio
    zone_id: str | None = None
    farm_id: str | None = None
    question: str


class SnapshotExportRequest(CLMModel):
    portfolio: Portfolio | None = None
    #: v1.1 (ADR-0026): several portfolios in one snapshot; the first is the primary. Wins over `portfolio`.
    portfolios: list[Portfolio] | None = None
    as_of: str | None = None
    sr: bool | None = True


class SnapshotPortfolio(CLMModel):
    """v1.1 (ADR-0026): one portfolio of a multi-portfolio snapshot and the files that hold it."""

    portfolio_id: str
    portfolio_name: str
    farm_ids: list[str] = Field(default_factory=list)
    portfolio_file: str
    assessment_file: str
    events_file: str


class SnapshotManifest(CLMModel):
    contract_version: Literal[1] = 1
    generated_at: str
    as_of: str
    portfolio_id: str
    portfolio_name: str
    farm_ids: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    imagery_frames: int = 0
    warnings: list[str] = Field(default_factory=list)
    #: v1.1 (ADR-0026): every portfolio in the snapshot, primary first. null in single-portfolio snapshots.
    portfolios: list[SnapshotPortfolio] | None = None


class SamplePortfolioSummary(CLMModel):
    """v1.1 (ADR-0026): one entry of GET /portfolios/samples."""

    id: str
    name: str
    code: str | None = None
    lender: str
    country: str
    currency: Currency
    farm_count: int
    crops: list[Crop] = Field(default_factory=list)
    description: str | None = None


# ───────────────────────────── Adapters for list responses ─────────────────────────────

CountryList = TypeAdapter(list[Country])
CropTemplateList = TypeAdapter(list[CropTemplate])
ClimateEventList = TypeAdapter(list[ClimateEvent])
ApiErrorList = TypeAdapter(list[ApiError])
SamplePortfolioSummaryList = TypeAdapter(list[SamplePortfolioSummary])

#: fixture file -> (validator, is_list). Used by tests and by the fixture fallback in routers.
FIXTURE_TYPES: dict[str, Any] = {
    "health.json": Health,
    "countries.json": CountryList,
    "crops.json": CropTemplateList,
    "portfolio-sample.json": Portfolio,
    "ciren-orchards.json": CirenOrchardCollection,
    "assessment-portfolio.json": PortfolioAssessment,
    "assessment-farm-cl-ovalle-table-grape.json": FarmAssessment,
    "imagery-cl-ovalle-table-grape.json": ImageryTimeline,
    "events.json": ClimateEventList,
    "agent-recommendation.json": AgentRecommendation,
    "manifest.json": SnapshotManifest,
    "errors.json": ApiErrorList,
}
