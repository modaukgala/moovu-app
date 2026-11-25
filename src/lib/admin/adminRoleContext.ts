"use client";

import { createContext } from "react";
import type { adminNavigation } from "./adminNavigation";

export const AdminRoleContext = createContext<Parameters<typeof adminNavigation>[0]>(null);
