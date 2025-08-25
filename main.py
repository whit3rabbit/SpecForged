#!/usr/bin/env python3
"""
SpecForge MCP Server - Entry point for local CLI execution.

A Model Context Protocol (MCP) server that implements specification-driven
development with EARS notation, intelligent mode classification, and
structured workflow management.
"""

from src.specforged.server import run_server

if __name__ == "__main__":
    run_server()
