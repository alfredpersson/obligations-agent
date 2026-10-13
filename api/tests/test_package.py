import obligations_agent


def test_package_is_installed() -> None:
    """Checks the test setup only: the package can be imported in the test environment."""
    assert obligations_agent.__name__ == "obligations_agent"
