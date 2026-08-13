"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import LEVELS, LOCATIONS, TICKET_SIZES


# ---------------------------------------------------------------------------
# Allocation periods
# ---------------------------------------------------------------------------

class AllocationPeriodBase(BaseModel):
    start_month: str = Field(..., pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    end_month: str = Field(..., pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    ftes: float = Field(0.0, ge=0.0)

    @field_validator("start_month", "end_month")
    @classmethod
    def month_in_range(cls, v: str) -> str:
        month = int(v.split("-")[1])
        if not 1 <= month <= 12:
            raise ValueError(f"Invalid month value in {v}")
        return v


class AllocationPeriodCreate(AllocationPeriodBase):
    pass


class AllocationPeriodOut(AllocationPeriodBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

class RoleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    location: str
    level: str
    ftes: float = Field(0.0, ge=0.0)
    use_advanced_allocation: bool = False

    @field_validator("location")
    @classmethod
    def valid_location(cls, v: str) -> str:
        if v not in LOCATIONS:
            raise ValueError(f"Invalid location: {v}. Must be one of {LOCATIONS}")
        return v

    @field_validator("level")
    @classmethod
    def valid_level(cls, v: str) -> str:
        if v not in LEVELS:
            raise ValueError(f"Invalid level: {v}. Must be one of {LEVELS}")
        return v


class RoleCreate(RoleBase):
    allocations: list[AllocationPeriodCreate] = []


class RoleUpdate(RoleCreate):
    pass


class RoleOut(RoleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    feature_id: int
    allocations: list[AllocationPeriodOut] = []


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------

class FeatureBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class FeatureCreate(FeatureBase):
    pass


class FeatureUpdate(FeatureBase):
    pass


class FeatureOut(FeatureBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    roles: list[RoleOut] = []


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectBase(BaseModel):
    name: str = Field("Project", min_length=1, max_length=255)
    company: str = Field("Company", min_length=1, max_length=255)
    start_year: int = Field(..., ge=1900, le=2200)
    start_month: int = Field(..., ge=1, le=12)
    end_year: int = Field(..., ge=1900, le=2200)
    end_month: int = Field(..., ge=1, le=12)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    company: Optional[str] = Field(None, min_length=1, max_length=255)
    start_year: Optional[int] = Field(None, ge=1900, le=2200)
    start_month: Optional[int] = Field(None, ge=1, le=12)
    end_year: Optional[int] = Field(None, ge=1900, le=2200)
    end_month: Optional[int] = Field(None, ge=1, le=12)


class ProjectSummary(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ProjectOut(ProjectSummary):
    features: list[FeatureOut] = []


# ---------------------------------------------------------------------------
# Rate configuration
# ---------------------------------------------------------------------------

class TicketSizeConfig(BaseModel):
    story_points: float = Field(0.0, ge=0.0)
    price: float = Field(0.0, ge=0.0)


class RateConfigOut(BaseModel):
    hourly_rates: dict[str, float]
    cost_rates: dict[str, dict[str, float]]
    sp_to_hours: float
    hw_cost_per_hour: float
    risk_factor_pct: float
    ticket_story_points: dict[str, float]
    ticket_prices: dict[str, float]
    ticket_quotas: dict[int, dict[str, float]]


class RateConfigUpdate(BaseModel):
    hourly_rates: Optional[dict[str, float]] = None
    cost_rates: Optional[dict[str, dict[str, float]]] = None
    sp_to_hours: Optional[float] = Field(None, ge=0.0)
    hw_cost_per_hour: Optional[float] = Field(None, ge=0.0)
    risk_factor_pct: Optional[float] = Field(None, ge=0.0)
    ticket_story_points: Optional[dict[str, float]] = None
    ticket_prices: Optional[dict[str, float]] = None
    ticket_quotas: Optional[dict[int, dict[str, float]]] = None

    @field_validator("hourly_rates")
    @classmethod
    def valid_hourly_locations(cls, v):
        if v is not None:
            for loc in v:
                if loc not in LOCATIONS:
                    raise ValueError(f"Invalid location: {loc}")
        return v

    @field_validator("cost_rates")
    @classmethod
    def valid_cost_keys(cls, v):
        if v is not None:
            for loc, levels in v.items():
                if loc not in LOCATIONS:
                    raise ValueError(f"Invalid location: {loc}")
                for lvl in levels:
                    if lvl not in LEVELS:
                        raise ValueError(f"Invalid level: {lvl}")
        return v

    @field_validator("ticket_story_points", "ticket_prices")
    @classmethod
    def valid_ticket_sizes(cls, v):
        if v is not None:
            for size in v:
                if size not in TICKET_SIZES:
                    raise ValueError(f"Invalid ticket size: {size}")
        return v

    @field_validator("ticket_quotas")
    @classmethod
    def valid_quota_sizes(cls, v):
        if v is not None:
            for year, sizes in v.items():
                for size in sizes:
                    if size not in TICKET_SIZES:
                        raise ValueError(f"Invalid ticket size: {size}")
        return v


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class CostProfitRow(BaseModel):
    year: str
    location: str
    man_hours: float
    cost: float
    selling_price: float
    hourly_cost: float
    hourly_rate: float
    profit: float
    profit_pct: float


class TicketAnalysisRow(BaseModel):
    year: str
    size: str
    story_points: float
    hours_per_ticket: float
    num_tickets: float
    total_hours: float
    hourly_rate: float
    revenue: float


class PivotTable(BaseModel):
    year: str
    columns: list[str]
    rows: list[dict]


class BudgetPlanOut(BaseModel):
    cost_profit_summary: list[CostProfitRow]
    cost_profit_overall: list[dict]
    ticket_analysis: list[TicketAnalysisRow]
    ticket_overall: list[dict]
    yearly_pivots: list[PivotTable]


class ResourcePlanOut(BaseModel):
    yearly_pivots: list[PivotTable]


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]


class MetaOut(BaseModel):
    locations: list[str]
    levels: list[str]
    ticket_sizes: list[str]
    hours_per_fte_per_month: int
