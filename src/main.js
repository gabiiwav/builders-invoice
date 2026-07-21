import * as calculations from './domain/calculations.js';
import * as money from './shared/money.js';
import * as validation from './shared/validation.js';
import { initializeMonitoring, reportError } from './monitoring.js';
import { createRepositories } from './data/repositories.js';

window.BuildersCore = Object.freeze({ calculations, money, validation, createRepositories, reportError });
initializeMonitoring();
