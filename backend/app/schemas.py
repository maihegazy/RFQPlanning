"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import LEVELS, LOCATIONS, PROJECT_STATUSES, TICKET_SIZES


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
    status: str = "draft"
    win_probability_pct: float = Field(50.0, ge=0.0, le=100.0)
    lost_reason: Optional[str] = Field(None, max_length=1000)

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in PROJECT_STATUSES:
            raise ValueError(f"Invalid status: {v}. Must be one of {PROJECT_STATUSES}")
        return v


class ProjectCreate(ProjectBase):
    template_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    company: Optional[str] = Field(None, min_length=1, max_length=255)
    start_year: Optional[int] = Field(None, ge=1900, le=2200)
    start_month: Optional[int] = Field(None, ge=1, le=12)
    end_year: Optional[int] = Field(None, ge=1900, le=2200)
    end_month: Optional[int] = Field(None, ge=1, le=12)
    status: Optional[str] = None
    win_probability_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    lost_reason: Optional[str] = Field(None, max_length=1000)

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in PROJECT_STATUSES:
            raise ValueError(f"Invalid status: {v}. Must be one of {PROJECT_STATUSES}")
        return v


class ProjectSummary(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    base_project_id: Optional[int] = None
    is_winning_scenario: bool = False
    created_at: datetime
    updated_at: datetime


class CloneRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    as_scenario: bool = True


class ProjectOut(ProjectSummary):
    features: list[FeatureOut] = []


# ---------------------------------------------------------------------------
# Rate configuration
# ---------------------------------------------------------------------------

class TicketSizeConfig(BaseModel):
    story_points: float = Field(0.0, ge=0.0)
    price: float = Field(0.0, ge=0.0)


class RateConfigOut(BaseModel):
    """Non-monetary configuration. Money lives in the encrypted blob."""

    sp_to_hours: float
    risk_factor_pct: float
    ticket_story_points: dict[str, float]
    ticket_quotas: dict[int, dict[str, float]]


class RateConfigUpdate(BaseModel):
    sp_to_hours: Optional[float] = Field(None, ge=0.0)
    risk_factor_pct: Optional[float] = Field(None, ge=0.0)
    ticket_story_points: Optional[dict[str, float]] = None
    ticket_quotas: Optional[dict[int, dict[str, float]]] = None

    @field_validator("ticket_story_points")
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


class LegacyMoneyOut(BaseModel):
    """Plaintext money read once from pre-encryption tables for migration."""

    hourly_rates: dict[str, float]
    cost_rates: dict[str, dict[str, float]]
    hw_cost_per_hour: float
    ticket_prices: dict[str, float]
    has_data: bool


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class PivotTable(BaseModel):
    year: str
    columns: list[str]
    rows: list[dict]


class ResourcePlanOut(BaseModel):
    yearly_pivots: list[PivotTable]


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]


# ---------------------------------------------------------------------------
# Vault (end-to-end encrypted money data)
# ---------------------------------------------------------------------------

class VaultKeys(BaseModel):
    kdf_salt: str = Field(..., max_length=64)
    kdf_iterations: int = Field(..., ge=100_000, le=10_000_000)
    wrapped_dek_passphrase_iv: str = Field(..., max_length=64)
    wrapped_dek_passphrase: str = Field(..., max_length=256)
    wrapped_dek_recovery_iv: str = Field(..., max_length=64)
    wrapped_dek_recovery: str = Field(..., max_length=256)


class VaultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    exists: bool = True
    kdf_salt: str
    kdf_iterations: int
    wrapped_dek_passphrase_iv: str
    wrapped_dek_passphrase: str
    wrapped_dek_recovery_iv: str
    wrapped_dek_recovery: str


class VaultPassphraseUpdate(BaseModel):
    kdf_salt: str = Field(..., max_length=64)
    kdf_iterations: int = Field(..., ge=100_000, le=10_000_000)
    wrapped_dek_passphrase_iv: str = Field(..., max_length=64)
    wrapped_dek_passphrase: str = Field(..., max_length=256)


class MoneyBlob(BaseModel):
    encrypted_money: Optional[str] = None
    money_iv: Optional[str] = Field(None, max_length=64)


class GridRoleUpdate(BaseModel):
    role_id: int
    ftes_by_month: dict[str, float] = Field(
        ..., description="Map of YYYY-MM to FTE value for every project month"
    )

    @field_validator("ftes_by_month")
    @classmethod
    def non_negative(cls, v):
        for month, fte in v.items():
            if fte < 0:
                raise ValueError(f"FTE for {month} cannot be negative")
        return v


class ResourceGridUpdate(BaseModel):
    roles: list[GridRoleUpdate]


class TemplateRoleOut(BaseModel):
    name: str
    location: str
    level: str
    ftes: float


class TemplateFeatureOut(BaseModel):
    name: str
    roles: list[TemplateRoleOut]


class TemplateOut(BaseModel):
    id: str
    name: str
    description: str
    features: list[TemplateFeatureOut]


class MetaOut(BaseModel):
    locations: list[str]
    levels: list[str]
    ticket_sizes: list[str]
    project_statuses: list[str]
    hours_per_fte_per_month: int
