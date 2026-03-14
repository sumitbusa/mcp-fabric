package com.demo.risk.model;

public class BreachRecord {
    private String breachId;
    private String counterpartyId;
    private String severity;
    private String openedAt;

    public String getBreachId() { return breachId; }
    public void setBreachId(String breachId) { this.breachId = breachId; }
    public String getCounterpartyId() { return counterpartyId; }
    public void setCounterpartyId(String counterpartyId) { this.counterpartyId = counterpartyId; }
    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }
    public String getOpenedAt() { return openedAt; }
    public void setOpenedAt(String openedAt) { this.openedAt = openedAt; }
}
