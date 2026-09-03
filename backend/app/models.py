"""SQLAlchemy ORM models."""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import (
    DEFAULT_HW_COST_PER_HOUR,
    DEFAULT_RISK_FACTOR_PCT,
    DEFAULT_SP_TO_HOURS,
)
from .database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Project")
    company: Mapped[str] = mapped_column(String(255), nullable=False, default="Company")
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    start_month: Mapped[int] = mapped_column(Integer, nullable=False)
    end_year: Mapped[int] = mapped_column(Integer, nullable=False)
    end_month: Mapped[int] = mapped_column(Integer, nullable=False)

    # Rate-configuration conversion factors (non-monetary)
    sp_to_hours: Mapped[float] = mapped_column(Float, default=DEFAULT_SP_TO_HOURS)
    hw_cost_per_hour: Mapped[float] = mapped_column(Float, default=DEFAULT_HW_COST_PER_HOUR)
    risk_factor_pct: Mapped[float] = mapped_column(Float, default=DEFAULT_RISK_FACTOR_PCT)

    # End-to-end encrypted money configuration. Ciphertext (AES-256-GCM,
    # base64) produced in the browser; the server never holds the key.
    encrypted_money: Mapped[str | None] = mapped_column(Text, nullable=True)
    money_iv: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # RFQ lifecycle
    status: Mapped[str] = mapped_column(String(16), default="draft", server_default="draft")
    win_probability_pct: Mapped[float] = mapped_column(Float, default=50.0, server_default="50")
    lost_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # Scenario linkage: a scenario is a full project row pointing at its base
    base_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    is_winning_scenario: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    features: Mapped[list["Feature"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Feature.id"
    )
    hourly_rates: Mapped[list["HourlyRate"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    cost_rates: Mapped[list["CostRate"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    ticket_configs: Mapped[list["TicketConfig"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    ticket_quotas: Mapped[list["TicketQuota"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    hardware_items: Mapped[list["HardwareItem"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="HardwareItem.id"
    )


class HardwareCatalogItem(Base):
    """Reusable master-catalog entry for hardware/tool planning (plaintext)."""

    __tablename__ = "hardware_catalog_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    aspice: Mapped[str] = mapped_column(String(16), default="SWE.3")
    billing: Mapped[str] = mapped_column(String(16), default="yearly")  # yearly | once
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    supplier_name: Mapped[str] = mapped_column(String(255), default="")
    supplier_email: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class HardwareItem(Base):
    """Hardware/tool row planned for one project.

    Values are snapshotted from the catalog at pick time so later catalog
    price changes never silently alter an existing quotation.
    `years_json` holds the project years the item applies to (JSON int list):
    every selected year counts once for yearly billing; a one-time purchase
    uses its single selected year.
    """

    __tablename__ = "hardware_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    catalog_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    aspice: Mapped[str] = mapped_column(String(16), default="SWE.3")
    billing: Mapped[str] = mapped_column(String(16), default="yearly")
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    years_json: Mapped[str] = mapped_column(Text, default="[]")
    supplier_name: Mapped[str] = mapped_column(String(255), default="")
    supplier_email: Mapped[str] = mapped_column(String(255), default="")

    project: Mapped["Project"] = relationship(back_populates="hardware_items")
    # Supplier contact is owned by the catalog entry (vendor-coupled), so the
    # plan reads it live from here; `supplier_email` is only the fallback
    # snapshot kept for rows whose catalog entry was deleted.
    catalog_item: Mapped["HardwareCatalogItem | None"] = relationship()


class CustomTemplate(Base):
    """User-defined project template (features/roles snapshot, no money)."""

    __tablename__ = "custom_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), default="")
    # JSON: [{"name": str, "roles": [{"name","location","level","ftes"}]}]
    features_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Vault(Base):
    """Singleton key-vault record for end-to-end encrypted money data.

    Stores only public KDF parameters and the data-encryption key wrapped
    by (1) the passphrase-derived key and (2) the recovery key. None of
    these are usable without the passphrase or recovery file, which never
    reach the server.
    """

    __tablename__ = "vault"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kdf_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    kdf_iterations: Mapped[int] = mapped_column(Integer, nullable=False)
    wrapped_dek_passphrase_iv: Mapped[str] = mapped_column(String(64), nullable=False)
    wrapped_dek_passphrase: Mapped[str] = mapped_column(String(256), nullable=False)
    wrapped_dek_recovery_iv: Mapped[str] = mapped_column(String(64), nullable=False)
    wrapped_dek_recovery: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Feature(Base):
    __tablename__ = "features"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    project: Mapped[Project] = relationship(back_populates="features")
    roles: Mapped[list["Role"]] = relationship(
        back_populates="feature", cascade="all, delete-orphan", order_by="Role.id"
    )


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feature_id: Mapped[int] = mapped_column(
        ForeignKey("features.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(32), nullable=False)
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    ftes: Mapped[float] = mapped_column(Float, default=0.0)
    use_advanced_allocation: Mapped[bool] = mapped_column(Boolean, default=False)

    feature: Mapped[Feature] = relationship(back_populates="roles")
    allocations: Mapped[list["AllocationPeriod"]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
        order_by="AllocationPeriod.start_month",
    )


class AllocationPeriod(Base):
    __tablename__ = "allocation_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_month: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    end_month: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    ftes: Mapped[float] = mapped_column(Float, default=0.0)

    role: Mapped[Role] = relationship(back_populates="allocations")


class HourlyRate(Base):
    """Hourly selling rate per location."""

    __tablename__ = "hourly_rates"
    __table_args__ = (UniqueConstraint("project_id", "location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location: Mapped[str] = mapped_column(String(32), nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0.0)

    project: Mapped[Project] = relationship(back_populates="hourly_rates")


class CostRate(Base):
    """Hourly cost rate per location and level."""

    __tablename__ = "cost_rates"
    __table_args__ = (UniqueConstraint("project_id", "location", "level"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location: Mapped[str] = mapped_column(String(32), nullable=False)
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0.0)

    project: Mapped[Project] = relationship(back_populates="cost_rates")


class TicketConfig(Base):
    """Story points and price per ticket size."""

    __tablename__ = "ticket_configs"
    __table_args__ = (UniqueConstraint("project_id", "size"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    size: Mapped[str] = mapped_column(String(16), nullable=False)
    story_points: Mapped[float] = mapped_column(Float, default=0.0)
    price: Mapped[float] = mapped_column(Float, default=0.0)

    project: Mapped[Project] = relationship(back_populates="ticket_configs")


class TicketQuota(Base):
    """Percentage quota per ticket size and year."""

    __tablename__ = "ticket_quotas"
    __table_args__ = (UniqueConstraint("project_id", "year", "size"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    size: Mapped[str] = mapped_column(String(16), nullable=False)
    quota_pct: Mapped[float] = mapped_column(Float, default=0.0)

    project: Mapped[Project] = relationship(back_populates="ticket_quotas")


class HwProject(Base):
    """A hardware purchasing project: the unit the working document tracked per file.

    Deliberately independent of `Project` (the RFQ quotation): purchasing runs on its
    own project list. `portal_reference` is reserved for the later link to the company
    portal's project list.
    """

    __tablename__ = "hw_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    company: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    budget_assets: Mapped[float] = mapped_column(Float, default=0.0)
    budget_licenses: Mapped[float] = mapped_column(Float, default=0.0)
    # Optional planning window; the summary always spans at least these years so a
    # project shows its full budget horizon before anything is purchased.
    start_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    portal_reference: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    assets: Mapped[list["HwAsset"]] = relationship(
        back_populates="hw_project", cascade="all, delete-orphan", order_by="HwAsset.id"
    )
    licenses: Mapped[list["HwLicense"]] = relationship(
        back_populates="hw_project", cascade="all, delete-orphan", order_by="HwLicense.id"
    )
    adjustments: Mapped[list["HwBudgetAdjustment"]] = relationship(
        back_populates="hw_project",
        cascade="all, delete-orphan",
        order_by="HwBudgetAdjustment.id",
    )


class HwAsset(Base):
    """One row of the working document's Assets register.

    `purchase_type` drives the per-year depreciation: only Purchase and Leasing
    rows produce cost, so a new row starts as "Not Purchased".
    """

    __tablename__ = "hw_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hw_project_id: Mapped[int] = mapped_column(
        ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_tag: Mapped[str] = mapped_column(String(255), default="")  # sheet column "ID"
    company: Mapped[str] = mapped_column(String(255), default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    serial: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(255), default="")
    supplier: Mapped[str] = mapped_column(String(255), default="")
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_cost: Mapped[float] = mapped_column(Float, default=0.0)
    order_number: Mapped[str] = mapped_column(String(255), default="")
    eol_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_employee: Mapped[str] = mapped_column(String(255), default="")
    sw_license: Mapped[str] = mapped_column(String(255), default="")
    purchased_by: Mapped[str] = mapped_column(String(255), default="")
    purchase_type: Mapped[str] = mapped_column(String(32), default="Not Purchased")
    catalog_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    hw_project: Mapped[HwProject] = relationship(back_populates="assets")
    catalog_item: Mapped["HardwareCatalogItem | None"] = relationship(
        "HardwareCatalogItem"
    )


class HwLicense(Base):
    """One row of the working document's Licenses register.

    `quantity` is the sheet's "Total" column; `depreciation` is the licence-side
    name for the asset register's "Purchase Type" and feeds the same engine.
    """

    __tablename__ = "hw_licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hw_project_id: Mapped[int] = mapped_column(
        ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    license_tag: Mapped[str] = mapped_column(String(255), default="")  # sheet column "ID"
    company: Mapped[str] = mapped_column(String(255), default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_key: Mapped[str] = mapped_column(String(255), default="")
    expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    licensed_to_email: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    supplier: Mapped[str] = mapped_column(String(255), default="")
    manufacturer: Mapped[str] = mapped_column(String(255), default="")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    termination_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    depreciation: Mapped[str] = mapped_column(String(32), default="Not Purchased")
    maintained: Mapped[bool] = mapped_column(Boolean, default=False)
    purchase_cost: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_order_number: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    catalog_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("hardware_catalog_items.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    hw_project: Mapped[HwProject] = relationship(back_populates="licenses")
    catalog_item: Mapped["HardwareCatalogItem | None"] = relationship(
        "HardwareCatalogItem"
    )


class HwBudgetAdjustment(Base):
    """Manual per-year correction, the Summary sheet's "Special Cases Budget".

    Added to the depreciated actuals of one register (`kind` = assets | licenses)
    for costs the two registers cannot express.
    """

    __tablename__ = "hw_budget_adjustments"
    __table_args__ = (UniqueConstraint("hw_project_id", "year", "kind"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hw_project_id: Mapped[int] = mapped_column(
        ForeignKey("hw_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    note: Mapped[str] = mapped_column(String(1000), default="")

    hw_project: Mapped[HwProject] = relationship(back_populates="adjustments")
