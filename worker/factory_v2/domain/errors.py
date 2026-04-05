class FactoryV2Error(Exception):
    """Base exception for the V2 workflow."""


class InvalidTransitionError(FactoryV2Error):
    """Raised when the state machine receives an invalid transition."""


class LeaseUnavailableError(FactoryV2Error):
    """Raised when a step cannot be leased."""


class StepExecutionError(FactoryV2Error):
    """Raised when a step executor fails."""
