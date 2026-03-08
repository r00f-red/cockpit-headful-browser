/*
 * SPDX-License-Identifier: MIT
 *
 * Headful Browser - Entry point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

// Use standard PatternFly instead of Cockpit-specific imports
import "@patternfly/patternfly/patternfly.css";
import "@patternfly/patternfly/patternfly-addons.css";

import { Application } from './app.js';

import './app.scss';

document.addEventListener("DOMContentLoaded", () => {
    const appElement = document.getElementById("app");
    if (appElement) {
        createRoot(appElement).render(<Application />);
    }
});
