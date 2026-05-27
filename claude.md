# ZAi-Fi — Offline Facial Recognition & Liveness Detection System
## Hackathon 7.0 Submission

---

# Project Vision

Build a lightweight, fully offline, mobile-based biometric authentication system for remote workforce operations.

The system performs:

- Offline face verification
- Offline liveness detection
- Local attendance storage
- Auto sync when internet returns
- Cross-platform support (Android + iOS)

The solution is designed for:
- low-network zones
- field workforce authentication
- mid-range mobile devices
- enterprise deployment readiness

---

# Problem Statement

Develop a secure offline facial recognition and liveness detection system compatible with React Native applications.

Constraints:
- Entirely offline
- Under ~20MB AI footprint
- <1 second authentication
- Android + iOS
- Open-source only
- Mid-range device support

---

# Our Strategic Positioning

This is NOT a simple face recognition app.

This is:

> "An Edge AI Biometric Authentication Infrastructure Layer for Remote Workforce Operations."

Core differentiators:
- Fully offline inference
- Lightweight edge AI
- Real-time liveness detection
- Enterprise-ready sync architecture
- React Native integration compatibility

---

# Technical Objectives

## Primary Goals

- Face verification accuracy >95%
- Authentication speed <1 sec
- Lightweight AI models
- Zero internet dependency
- Smooth operation on 3GB RAM devices

---

# Final Architecture

```text
React Native Mobile App
        |
        |-- Camera Stream
        |
        |-- Face Detection Engine
        |
        |-- Face Embedding Engine
        |
        |-- Local Verification Engine
        |
        |-- Liveness Detection Engine
        |
        |-- Offline Storage
        |
        |-- Sync Queue Engine
        |
        |-- AWS Sync API (future scope)