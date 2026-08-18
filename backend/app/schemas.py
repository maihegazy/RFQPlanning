"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .config import (
    ASPICE_PROCESSES,
    HARDWARE_BILLING,
    LEVELS,
    LOCATIONS,
    PROJECT_STATUSES,
    TICKET_SIZES,
)


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
    allocations: list[AllocationPeriodCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_allocation_mode(self):
        if not self.use_advanced_allocation:
            if self.ftes > 2.0:
                raise ValueError(
                    "FTEs cannot exceed 2.0 for fixed allocation; "
                    "use variable periods for higher values"
                )
            return self

        if not self.allocations:
            raise ValueError("Variable allocation requires at least one period")

        periods = sorted(self.allocations, key=lambda period: period.start_month)
        for period in periods:
            if period.start_month > period.end_month:
                raise ValueError(
                    "Allocation period start month must be before or equal to end month"
                )
        for current, following in zip(periods, periods[1:]):
            if current.end_month >= following.start_month:
                raise ValueError("Allocation periods cannot overlap")
        return self


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

    @model_validator(mode="after")
    def valid_date_range(self):
        if (self.start_year, self.start_month) > (self.end_year, self.end_month):
            raise ValueError("Project start date must be before or equal to end date")
        return self


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
                for size, pct in sizes.items():
                    if size not in TICKET_SIZES:
                        raise ValueError(f"Invalid ticket size: {size}")
                    if pct < 0 or pct > 100:
                        raise ValueError(
                            f"Quota for {size} in {year} must be between 0 and 100%"
                        )
                total = sum(sizes.values())
                if total > 100:
                    raise ValueError(
                        f"Ticket quotas for {year} sum to {total:g}% — "
                        "the total per year cannot exceed 100%"
                    )
        return v


class LegacyMoneyOut(BaseModel):
    """Plaintext money read once from pre-encryption tables for migration."""

    hourly_rates: dict[str, float]
    cost_rates: dict[str, dict[str, float]]
    hw_cost_per_hour: float
    ticket_prices: dict[str, float]
    has_data: bool


# ---------------------------------------------------------------------------
# Legacy desktop JSON import
# ---------------------------------------------------------------------------

class LegacyRoleImport(RoleCreate):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: str = Field(..., alias="Role", min_length=1, max_length=255)
    location: str = Field(..., alias="Location")
    level: str = Field(..., alias="Level")
    ftes: float = Field(0.0, alias="FTEs", ge=0.0)


class LegacyFeatureImport(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: str = Field(..., alias="Feature", min_length=1, max_length=255)
    roles: list[LegacyRoleImport] = Field(default_factory=list, alias="Roles")


class LegacyRateConfigImport(BaseModel):
    """Validated non-monetary settings; legacy money fields remain allowed."""

    model_config = ConfigDict(extra="allow")

    sp_to_hours: float = Field(4.0, ge=0.0)
    risk_factor_pct: float = Field(0.0, ge=0.0)
    ticket_sp: dict[str, float] = Field(default_factory=dict)
    ticket_quota: dict[int, dict[str, float]] = Field(default_factory=dict)

    @field_validator("ticket_sp")
    @classmethod
    def valid_story_points(cls, values):
        for size, points in values.items():
            if size not in TICKET_SIZES:
                raise ValueError(f"Invalid ticket size: {size}")
            if points < 0:
                raise ValueError(f"Story points for {size} cannot be negative")
        return values

    @field_validator("ticket_quota")
    @classmethod
    def valid_quotas(cls, values):
        for year, quotas in values.items():
            for size, percentage in quotas.items():
                if size not in TICKET_SIZES:
                    raise ValueError(f"Invalid ticket size: {size}")
                if not 0 <= percentage <= 100:
                    raise ValueError(
                        f"Quota for {size} in {year} must be between 0 and 100%"
                    )
            if sum(quotas.values()) > 100:
                raise ValueError(f"Ticket quotas for {year} cannot exceed 100%")
        return values


class LegacyProjectImport(BaseModel):
    model_config = ConfigDict(extra="allow")

    project_name: str = Field("Project", min_length=1, max_length=255)
    company_name: str = Field("Company", min_length=1, max_length=255)
    dates: tuple[int, int, int, int]
    status: str = "draft"
    win_probability_pct: float = Field(50.0, ge=0.0, le=100.0)
    lost_reason: Optional[str] = Field(None, max_length=1000)
    features: list[LegacyFeatureImport] = Field(default_factory=list)
    rate_config: LegacyRateConfigImport = Field(default_factory=LegacyRateConfigImport)

    @field_validator("status")
    @classmethod
    def valid_import_status(cls, value):
        if value not in PROJECT_STATUSES:
            raise ValueError(
                f"Invalid status: {value}. Must be one of {PROJECT_STATUSES}"
            )
        return value

    @model_validator(mode="after")
    def valid_import_dates(self):
        start_year, start_month, end_year, end_month = self.dates
        if not 1900 <= start_year <= 2200 or not 1900 <= end_year <= 2200:
            raise ValueError("Import years must be between 1900 and 2200")
        if not 1 <= start_month <= 12 or not 1 <= end_month <= 12:
            raise ValueError("Import months must be between 1 and 12")
        if (start_year, start_month) > (end_year, end_month):
            raise ValueError("Project start date must be before or equal to end date")
        project_start = f"{start_year:04d}-{start_month:02d}"
        project_end = f"{end_year:04d}-{end_month:02d}"
        for feature in self.features:
            for role in feature.roles:
                for period in role.allocations:
                    if (
                        period.start_month < project_start
                        or period.end_month > project_end
                    ):
                        raise ValueError(
                            f"Allocation period for {role.name} must stay within "
                            f"project timeline {project_start} to {project_end}"
                        )
        return self


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
    custom: bool = False
    features: list[TemplateFeatureOut]


class SaveTemplateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=1000)


class MetaOut(BaseModel):
    locations: list[str]
    levels: list[str]
    ticket_sizes: list[str]
    project_statuses: list[str]
    hours_per_fte_per_month: int
    aspice_processes: list[str]
    hardware_billing: list[str]


# ---------------------------------------------------------------------------
# Hardware planning (plaintext by design — not part of the encrypted vault)
# ---------------------------------------------------------------------------

class HardwareCatalogItemBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    aspice: str = "SWE.3"
    billing: str = "yearly"
    unit_cost: float = Field(0.0, ge=0.0)
    supplier_name: str = Field("", max_length=255)
    supplier_email: str = Field("", max_length=255)

    @field_validator("aspice")
    @classmethod
    def valid_aspice(cls, v: str) -> str:
        if v not in ASPICE_PROCESSES:
            raise ValueError(f"Invalid ASPICE process: {v}")
        return v

    @field_validator("billing")
    @classmethod
    def valid_billing(cls, v: str) -> str:
        if v not in HARDWARE_BILLING:
            raise ValueError(
                f"Invalid billing mode: {v}. Must be one of {HARDWARE_BILLING}"
            )
        return v


class HardwareCatalogItemCreate(HardwareCatalogItemBase):
    pass


class HardwareCatalogItemUpdate(HardwareCatalogItemBase):
    pass


class HardwareCatalogItemOut(HardwareCatalogItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class HardwareItemBase(HardwareCatalogItemBase):
    qty: int = Field(1, ge=0)
    years: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_years(self):
        self.years = sorted(set(self.years))
        for year in self.years:
            if not 1900 <= year <= 2200:
                raise ValueError(f"Invalid year: {year}")
        if self.billing == "once" and len(self.years) > 1:
            raise ValueError(
                "A one-time purchase can only have a single purchase year"
            )
        return self


class HardwareItemCreate(HardwareItemBase):
    catalog_item_id: Optional[int] = None


class HardwareItemUpdate(HardwareItemBase):
    catalog_item_id: Optional[int] = None


class HardwareItemOut(HardwareItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    catalog_item_id: Optional[int] = None
    total: float = 0.0


class HardwarePlanOut(BaseModel):
    items: list[HardwareItemOut]
    per_year: dict[int, float]
    grand_total: float
