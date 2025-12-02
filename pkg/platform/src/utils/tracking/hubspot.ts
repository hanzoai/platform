// Hubspot tracking utility for user registration
// This is a stub implementation - enable by setting HUBSPOT_ACCESS_TOKEN env var

export interface HubspotContact {
  email: string;
  firstname?: string;
  lastname?: string;
  company?: string;
}

export interface HubspotFormData {
  email: string;
  firstname?: string;
  lastname?: string;
  [key: string]: string | undefined;
}

/**
 * Get HubSpot tracking cookie (UTK) from cookie string
 */
export const getHubSpotUTK = (cookieString: string | undefined): string | undefined => {
  if (!cookieString) return undefined;

  const hubspotCookie = cookieString
    .split(";")
    .find((c) => c.trim().startsWith("hubspotutk="));

  if (!hubspotCookie) return undefined;

  return hubspotCookie.split("=")[1];
};

/**
 * Submit form data to HubSpot
 * @returns true if submission successful, false otherwise
 */
export const submitToHubSpot = async (
  formData: HubspotFormData,
  hutk?: string,
  pageUri?: string,
  pageName?: string
): Promise<boolean> => {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const formGuid = process.env.HUBSPOT_FORM_GUID;

  if (!portalId || !formGuid) {
    // HubSpot not configured - return true to not trigger error handling
    return true;
  }

  try {
    const fields = Object.entries(formData)
      .filter(([_, value]) => value !== undefined)
      .map(([name, value]) => ({ name, value }));

    const body: Record<string, unknown> = {
      fields,
      context: {
        pageUri: pageUri || "",
        pageName: pageName || "Registration",
      },
    };

    if (hutk) {
      body.context = { ...body.context as object, hutk };
    }

    const response = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      console.error("Failed to submit to HubSpot:", await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("HubSpot submission error:", error);
    return false;
  }
};

/**
 * Track user registration in HubSpot via API
 */
export const trackUserRegistration = async (contact: HubspotContact): Promise<void> => {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    // Hubspot tracking disabled
    return;
  }

  try {
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        properties: {
          email: contact.email,
          firstname: contact.firstname || "",
          lastname: contact.lastname || "",
          company: contact.company || "",
        },
      }),
    });

    if (!response.ok) {
      console.error("Failed to track user in Hubspot:", await response.text());
    }
  } catch (error) {
    console.error("Hubspot tracking error:", error);
  }
};

/**
 * Update an existing HubSpot contact
 */
export const updateHubspotContact = async (
  email: string,
  properties: Record<string, string>
): Promise<void> => {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    return;
  }

  try {
    // First search for the contact
    const searchResponse = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: email,
          }],
        }],
      }),
    });

    if (!searchResponse.ok) {
      return;
    }

    const searchData = await searchResponse.json();
    const contactId = searchData.results?.[0]?.id;

    if (!contactId) {
      return;
    }

    // Update the contact
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ properties }),
    });
  } catch (error) {
    console.error("Hubspot update error:", error);
  }
};
