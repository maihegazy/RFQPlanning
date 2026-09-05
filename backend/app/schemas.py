"""Pydantic request/response schemas."""

from datetime import UTC, date, datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    field_validator,
    model_validator,
)

from .config import (
    ASPICE_PROCESSES,
    DATE_WINDOW_YEARS,
    HARDWARE_BILLING,
    HW_BUDGET_MODES,
    LEVELS,
    LOCATIONS,
    MAX_MONEY,
    MAX_QUANTITY,
    PROJECT_STATUSES,
    TICKET_SIZES,
)


class ApiModel(BaseModel):
    """Base of every schema: JSON has no NaN or Infinity, so neither do we."""

    model_config = ConfigDict(allow_inf_nan=False)


def _cents(value: float) -> float:
    return round(value, 2)


def _iso_utc(value: datetime) -> str:
    """Timestamps leave the API with an explicit UTC offset.

    The columns store naive UTC (see `models.utc_now`); a bare
    "2026-09-05T10:00:00" would be read as local time by every browser.
    """
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")


UtcDatetime = Annotated[datetime, PlainSerializer(_iso_utc, return_type=str)]


# Money is stored to the cent: what the export writes is what the import reads back.
Money = Annotated[float, AfterValidator(_cents)]


def _valid_quota_years(quotas: dict[int, dict[str, float]]) -> None:
    for year in quotas:
        if not 1900 <= year <= 2200:
            raise ValueError(f"Ticket quota year {year} must be between 1900 and 2200")

# ---------------------------------------------------------------------------
# Allocation periods
# ---------------------------------------------------------------------------

class AllocationPeriodBase(ApiModel):
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

class RoleBase(ApiModel):
    name: str = Field(..., min_length=1, max_length=255)
    location: str
    level: str
    ftes: float = Field(0.0, ge=0.0, le=10_000)
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
            # Periods only mean something for a variable role. Keeping them on a fixed
            # role stores data the app ignores and the importer then rejects.
            self.allocations = []
            return self

        if not self.allocations:
            raise ValueError("Variable allocation requires at least one period")

        periods = sorted(self.allocations, key=lambda period: period.start_month)
        for period in periods:
            if period.start_month > period.end_month:
                raise ValueError(
                    "Allocation period start month must be before or equal to end month"
                )
        for current, following in zip(periods, periods[1:], strict=False):
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

class FeatureBase(ApiModel):
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

class ProjectBase(ApiModel):
    name: str = Field("Project", min_length=1, max_length=255)
    company: str = Field("Company", min_length=1, max_length=255)
    start_year: int = Field(..., ge=1900, le=2200)
    start_month: int = Field(..., ge=1, le=12)
    end_year: int = Field(..., ge=1900, le=2200)
    end_month: int = Field(..., ge=1, le=12)
    status: str = "draft"
    win_probability_pct: float = Field(50.0, ge=0.0, le=100.0)
    lost_reason: str | None = Field(None, max_length=1000)

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
    template_id: str | None = None


class ProjectUpdate(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    company: str | None = Field(None, min_length=1, max_length=255)
    start_year: int | None = Field(None, ge=1900, le=2200)
    start_month: int | None = Field(None, ge=1, le=12)
    end_year: int | None = Field(None, ge=1900, le=2200)
    end_month: int | None = Field(None, ge=1, le=12)
    status: str | None = None
    win_probability_pct: float | None = Field(None, ge=0.0, le=100.0)
    lost_reason: str | None = Field(None, max_length=1000)

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v is not None and v not in PROJECT_STATUSES:
            raise ValueError(f"Invalid status: {v}. Must be one of {PROJECT_STATUSES}")
        return v


class ProjectSummary(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    base_project_id: int | None = None
    is_winning_scenario: bool = False
    # Optimistic-concurrency token: send it back as `expected_version` on writes.
    version: int = 1
    created_at: UtcDatetime
    updated_at: UtcDatetime


class CloneRequest(ApiModel):
    name: str = Field(..., min_length=1, max_length=255)
    as_scenario: bool = True


class ProjectOut(ProjectSummary):
    features: list[FeatureOut] = []


# ---------------------------------------------------------------------------
# Rate configuration
# ---------------------------------------------------------------------------

class TicketSizeConfig(ApiModel):
    story_points: float = Field(0.0, ge=0.0)
    price: float = Field(0.0, ge=0.0)


class RateConfigOut(ApiModel):
    """Non-monetary configuration. Money lives in the encrypted blob."""

    sp_to_hours: float
    risk_factor_pct: float
    ticket_story_points: dict[str, float]
    ticket_quotas: dict[int, dict[str, float]]
    # The hardware plan's totals per project year: the cost-profit analysis
    # carries them as a non-labor row, billed to the customer when the flag is on.
    hardware_costs_per_year: dict[int, float] = Field(default_factory=dict)
    hardware_pass_through: bool = False
    # The project's version after the read or write, for the next `expected_version`.
    version: int = 1


class RateConfigUpdate(ApiModel):
    sp_to_hours: float | None = Field(None, ge=0.0, le=1_000_000)
    risk_factor_pct: float | None = Field(None, ge=0.0, le=1_000_000)
    ticket_story_points: dict[str, float] | None = None
    ticket_quotas: dict[int, dict[str, float]] | None = None
    hardware_pass_through: bool | None = None
    # The project version the client last saw; a mismatch is a 409, nothing is written.
    expected_version: int | None = Field(None, ge=1)

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
            _valid_quota_years(v)
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


class LegacyMoneyOut(ApiModel):
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


class LegacyFeatureImport(ApiModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    name: str = Field(..., alias="Feature", min_length=1, max_length=255)
    roles: list[LegacyRoleImport] = Field(default_factory=list, alias="Roles")


class LegacyRateConfigImport(ApiModel):
    """Validated non-monetary settings; legacy money fields remain allowed."""

    model_config = ConfigDict(extra="allow")

    sp_to_hours: float = Field(4.0, ge=0.0)
    risk_factor_pct: float = Field(0.0, ge=0.0)
    ticket_sp: dict[str, float] = Field(default_factory=dict)
    ticket_quota: dict[int, dict[str, float]] = Field(default_factory=dict)
    hardware_pass_through: bool = False

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
        _valid_quota_years(values)
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


class LegacyHardwareItemImport(ApiModel):
    """A hardware-plan row in the JSON export; the catalog link travels by name."""

    model_config = ConfigDict(extra="allow")

    name: str = Field(..., min_length=1, max_length=255)
    aspice: str = "SWE.3"
    billing: str = "yearly"
    unit_cost: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    qty: int = Field(1, ge=0, le=MAX_QUANTITY)
    years: list[int] = Field(default_factory=list)
    supplier_name: str = Field("", max_length=255)
    supplier_email: str = Field("", max_length=255)
    catalog_item_name: str = Field("", max_length=255)

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
            raise ValueError(f"Invalid billing mode: {v}")
        return v


class LegacyProjectImport(ApiModel):
    model_config = ConfigDict(extra="allow")

    project_name: str = Field("Project", min_length=1, max_length=255)
    company_name: str = Field("Company", min_length=1, max_length=255)
    dates: tuple[int, int, int, int]
    status: str = "draft"
    win_probability_pct: float = Field(50.0, ge=0.0, le=100.0)
    lost_reason: str | None = Field(None, max_length=1000)
    features: list[LegacyFeatureImport] = Field(default_factory=list)
    rate_config: LegacyRateConfigImport = Field(default_factory=LegacyRateConfigImport)
    hardware_items: list[LegacyHardwareItemImport] = Field(default_factory=list)

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
        for item in self.hardware_items:
            for year in item.years:
                if not start_year <= year <= end_year:
                    raise ValueError(
                        f"Hardware item {item.name} is planned for {year}, outside "
                        f"the project years {start_year} to {end_year}"
                    )
        return self


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class PivotTable(ApiModel):
    year: str
    columns: list[str]
    rows: list[dict]


class ResourcePlanOut(ApiModel):
    yearly_pivots: list[PivotTable]


class ValidationResult(ApiModel):
    valid: bool
    errors: list[str]


# ---------------------------------------------------------------------------
# Vault (end-to-end encrypted money data)
# ---------------------------------------------------------------------------

# A digest of the unwrapped data key (base64 SHA-256), computed in the browser
# after a successful unlock. The server stores it and never returns it.
Verifier = Annotated[str, Field(min_length=16, max_length=64)]


class VaultKeys(ApiModel):
    kdf_salt: str = Field(..., max_length=64)
    kdf_iterations: int = Field(..., ge=100_000, le=10_000_000)
    wrapped_dek_passphrase_iv: str = Field(..., max_length=64)
    wrapped_dek_passphrase: str = Field(..., max_length=256)
    wrapped_dek_recovery_iv: str = Field(..., max_length=64)
    wrapped_dek_recovery: str = Field(..., max_length=256)
    dek_verifier: Verifier


class VaultOut(ApiModel):
    exists: bool = True
    kdf_salt: str
    kdf_iterations: int
    wrapped_dek_passphrase_iv: str
    wrapped_dek_passphrase: str
    wrapped_dek_recovery_iv: str
    wrapped_dek_recovery: str
    # False on a vault created before verifiers existed, until its first unlock
    # registers one (POST /api/vault/verifier).
    has_verifier: bool = False


class VaultCurrentKey(ApiModel):
    """The passphrase copy of the key as the client last read it.

    Sent back with every change so a request built from a stale read (someone
    else changed the passphrase in between) is refused instead of applied.
    """

    current_wrapped_dek_passphrase_iv: str = Field(..., max_length=64)
    current_wrapped_dek_passphrase: str = Field(..., max_length=256)


class VaultPassphraseUpdate(VaultCurrentKey):
    kdf_salt: str = Field(..., max_length=64)
    kdf_iterations: int = Field(..., ge=100_000, le=10_000_000)
    wrapped_dek_passphrase_iv: str = Field(..., max_length=64)
    wrapped_dek_passphrase: str = Field(..., max_length=256)
    dek_verifier: Verifier


class VaultVerifierRegistration(VaultCurrentKey):
    dek_verifier: Verifier


class MoneyBlobOut(ApiModel):
    encrypted_money: str | None = None
    money_iv: str | None = None
    # The project's version after the read or write, for the next `expected_version`.
    version: int = 1


class MoneyBlobUpdate(ApiModel):
    encrypted_money: str | None = None
    money_iv: str | None = Field(None, max_length=64)
    expected_version: int | None = Field(None, ge=1)

    @model_validator(mode="after")
    def both_or_neither(self):
        # Ciphertext without its IV (or the other way round) can never be
        # decrypted; storing it would lose the project's money silently.
        if (self.encrypted_money is None) != (self.money_iv is None):
            raise ValueError("encrypted_money and money_iv must be given together or not at all")
        return self


class GridRoleUpdate(ApiModel):
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
            if fte > 10_000:
                raise ValueError(f"FTE for {month} is not a plausible value")
        return v


class ResourceGridUpdate(ApiModel):
    roles: list[GridRoleUpdate]


class TemplateRoleOut(ApiModel):
    name: str
    location: str
    level: str
    ftes: float


class TemplateFeatureOut(ApiModel):
    name: str
    roles: list[TemplateRoleOut]


class TemplateOut(ApiModel):
    id: str
    name: str
    description: str
    custom: bool = False
    features: list[TemplateFeatureOut]


class SaveTemplateRequest(ApiModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=1000)


class MetaOut(ApiModel):
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

class HardwareCatalogItemBase(ApiModel):
    name: str = Field(..., min_length=1, max_length=255)
    aspice: str = "SWE.3"
    billing: str = "yearly"
    unit_cost: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
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
    created_at: UtcDatetime


class HardwareItemBase(HardwareCatalogItemBase):
    qty: int = Field(1, ge=0, le=MAX_QUANTITY)
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
    catalog_item_id: int | None = None


class HardwareItemUpdate(HardwareItemBase):
    catalog_item_id: int | None = None


class HardwareItemUpsert(HardwareItemCreate):
    """A row of a whole-plan save: an id keeps the stored row, none creates one."""

    id: int | None = None


class HardwareBulkUpdate(ApiModel):
    items: list[HardwareItemUpsert] = Field(default_factory=list)
    expected_version: int | None = Field(None, ge=1)


class HardwareItemOut(HardwareItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    catalog_item_id: int | None = None
    total: float = 0.0


class HardwarePlanOut(ApiModel):
    items: list[HardwareItemOut]
    per_year: dict[int, float]
    grand_total: float
    # Rows planned for a year the project no longer covers (a shortened timeline).
    warnings: list[str] = Field(default_factory=list)
    # The project's version after the read or write, for the next `expected_version`.
    version: int = 1


# ---------------------------------------------------------------------------
# Hardware management (the Assets/Licenses registers of the HW working document)
# ---------------------------------------------------------------------------

class HwProjectInput(ApiModel):
    name: str = Field(..., min_length=1, max_length=255)
    company: str = Field("", max_length=255)
    description: str = Field("", max_length=4000)
    # "split" budgets assets and licenses separately; "overall" approves one
    # number and leaves the split unknown. A client that omits the mode gets
    # "overall", unless it sends split figures and no overall one.
    budget_mode: str | None = None
    budget_total: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    budget_assets: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    budget_licenses: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    # Optional planning window: the summary always spans at least these years,
    # so a project shows its whole budget horizon before anything is bought.
    start_year: int | None = Field(None, ge=DATE_WINDOW_YEARS[0], le=DATE_WINDOW_YEARS[1])
    end_year: int | None = Field(None, ge=DATE_WINDOW_YEARS[0], le=DATE_WINDOW_YEARS[1])
    portal_reference: str = Field("", max_length=255)

    @field_validator("budget_mode")
    @classmethod
    def _known_budget_mode(cls, value: str | None) -> str | None:
        if value is not None and value not in HW_BUDGET_MODES:
            raise ValueError(f"budget_mode must be one of {HW_BUDGET_MODES}")
        return value

    @model_validator(mode="after")
    def _infer_mode_and_check_window(self):
        if self.budget_mode is None:
            split_only = (self.budget_assets or self.budget_licenses) and not self.budget_total
            self.budget_mode = "split" if split_only else "overall"
        if (
            self.start_year is not None
            and self.end_year is not None
            and self.start_year > self.end_year
        ):
            raise ValueError("The planning window's start year must not be after its end year")
        return self


class HwProjectOut(HwProjectInput):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # Optimistic-concurrency token: send it back as `expected_version` on writes.
    version: int = 1
    created_at: UtcDatetime
    updated_at: UtcDatetime


class HwProjectRollupOut(HwProjectOut):
    """A project row of the management overview: its own budget position."""

    asset_count: int = 0
    license_count: int = 0
    actual_total: float = 0.0
    planned_total: float = 0.0
    # What the project has to spend: the overall figure in "overall" mode, the
    # sum of the two component budgets in "split" mode. `budget_total` above
    # stays the stored figure, so a row echoed back through PUT changes nothing.
    effective_budget: float = 0.0
    remaining: float = 0.0
    licenses_expired: int = 0
    licenses_expiring_90: int = 0


# The vocabularies in config.py only populate the dropdowns: the registers were
# free text in the sheet and stay free text here, so no value validators.
class HwAssetInput(ApiModel):
    # In a whole-register save, an id keeps the stored row (its id and
    # created_at survive); a row without one is created.
    id: int | None = None
    asset_tag: str = Field("", max_length=255)
    company: str = Field("", max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    serial: str = Field("", max_length=255)
    model: str = Field("", max_length=255)
    category: str = Field("", max_length=255)
    status: str = Field("", max_length=255)
    supplier: str = Field("", max_length=255)
    purchase_date: date | None = None
    purchase_cost: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    order_number: str = Field("", max_length=255)
    eol_date: date | None = None
    assigned_employee: str = Field("", max_length=255)
    sw_license: str = Field("", max_length=255)
    purchased_by: str = Field("", max_length=255)
    purchase_type: str = Field("Not Purchased", max_length=32)
    catalog_item_id: int | None = None


class HwAssetOut(HwAssetInput):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hw_project_id: int
    per_year: dict[str, float] = Field(default_factory=dict)
    total: float = 0.0
    # Why the row contributes nothing to any year (missing dates, an unknown
    # purchase type, a date outside the window), or null when it counts.
    uncounted_reason: str | None = None


class HwLicenseInput(ApiModel):
    id: int | None = None
    license_tag: str = Field("", max_length=255)
    company: str = Field("", max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    product_key: str = Field("", max_length=255)
    expiration_date: date | None = None
    licensed_to_email: str = Field("", max_length=255)
    category: str = Field("", max_length=255)
    supplier: str = Field("", max_length=255)
    manufacturer: str = Field("", max_length=255)
    quantity: int = Field(1, ge=0, le=MAX_QUANTITY)
    purchase_date: date | None = None
    termination_date: date | None = None
    depreciation: str = Field("Not Purchased", max_length=32)
    maintained: bool = False
    purchase_cost: Money = Field(0.0, ge=0.0, le=MAX_MONEY)
    purchase_order_number: str = Field("", max_length=255)
    notes: str = Field("", max_length=4000)
    catalog_item_id: int | None = None


class HwLicenseOut(HwLicenseInput):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hw_project_id: int
    per_year: dict[str, float] = Field(default_factory=dict)
    total: float = 0.0
    # Why the row contributes nothing to any year (missing dates, an unknown
    # purchase type, a date outside the window), or null when it counts.
    uncounted_reason: str | None = None


class HwAssetBulk(ApiModel):
    items: list[HwAssetInput] = Field(default_factory=list)
    expected_version: int | None = Field(None, ge=1)


class HwAssetBulkOut(ApiModel):
    version: int
    items: list[HwAssetOut]


class HwLicenseBulk(ApiModel):
    items: list[HwLicenseInput] = Field(default_factory=list)
    expected_version: int | None = Field(None, ge=1)


class HwLicenseBulkOut(ApiModel):
    version: int
    items: list[HwLicenseOut]


class HwAdjustment(ApiModel):
    """One "Special Cases Budget" cell of the Summary sheet (columns I and J)."""

    model_config = ConfigDict(from_attributes=True)

    year: int = Field(..., ge=1900, le=2200)
    kind: str
    amount: Money = Field(0.0, ge=-MAX_MONEY, le=MAX_MONEY)
    note: str = Field("", max_length=1000)

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        kind = v.strip().lower()
        if kind not in ("assets", "licenses"):
            raise ValueError(
                f"Invalid adjustment kind: {v}. Must be assets or licenses"
            )
        return kind


class HwAdjustmentBulk(ApiModel):
    items: list[HwAdjustment] = Field(default_factory=list)
    expected_version: int | None = Field(None, ge=1)

    @model_validator(mode="after")
    def unique_year_and_kind(self):
        seen = set()
        for item in self.items:
            key = (item.year, item.kind)
            if key in seen:
                raise ValueError(
                    f"Duplicate {item.kind} adjustment for {item.year}; "
                    "a year carries one adjustment per register"
                )
            seen.add(key)
        return self


class HwAdjustmentBulkOut(ApiModel):
    version: int
    items: list[HwAdjustment]


class HwYearRow(ApiModel):
    year: int
    actual_assets: float
    actual_licenses: float
    actual_total: float
    planned_assets: float
    planned_licenses: float
    planned_total: float
    grand_total: float


class HwRenewalRisk(ApiModel):
    expired: int
    in_30_days: int
    in_60_days: int
    in_90_days: int


class HwPivotRow(ApiModel):
    category: str
    counts: dict[str, int]
    total: int


class HwPivot(ApiModel):
    statuses: list[str]
    rows: list[HwPivotRow]


class HwLicenseExpiry(ApiModel):
    id: int
    name: str
    manufacturer: str
    expiration_date: date
    days_left: int
    hw_project_id: int
    hw_project_name: str


class HwDashboard(ApiModel):
    budget_total: float
    budget_assets: float
    budget_licenses: float
    spent_total: float
    planned_total: float
    remaining: float


class HwSummaryOut(ApiModel):
    years: list[HwYearRow]
    totals: HwYearRow
    risk: HwRenewalRisk
    expiring: list[HwLicenseExpiry]
    asset_pivot: HwPivot
    license_pivot: HwPivot
    dashboard: HwDashboard
    asset_count: int
    license_count: int
    # Register rows the engine could not count (see HwAssetOut.uncounted_reason).
    uncounted_rows: int = 0
    adjustments: list[HwAdjustment]


class HwOverviewOut(ApiModel):
    projects: list[HwProjectRollupOut]
    years: list[HwYearRow]
    totals: HwYearRow
    risk: HwRenewalRisk
    expiring: list[HwLicenseExpiry]
    asset_pivot: HwPivot
    dashboard: HwDashboard
    project_count: int
    asset_count: int
    license_count: int
    uncounted_rows: int = 0


class HwImportPreview(ApiModel):
    assets: list[HwAssetInput]
    licenses: list[HwLicenseInput]
    warnings: list[str]
    sheets_found: list[str]


class HwImportResult(ApiModel):
    created_assets: int
    created_licenses: int
    # Rows removed first when the import replaced a register.
    replaced_assets: int = 0
    replaced_licenses: int = 0
    warnings: list[str]


class HwMetaOut(ApiModel):
    purchase_types: list[str]
    asset_statuses: list[str]
    asset_categories: list[str]
    license_categories: list[str]
    budget_modes: list[str]
    leasing_months: int
