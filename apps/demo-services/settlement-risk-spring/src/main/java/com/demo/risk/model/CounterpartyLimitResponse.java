package com.demo.risk.model;

public class CounterpartyLimitResponse {
    private String counterpartyId;
    private Double creditLimit;
    private Double utilized;
    private Double availableHeadroom;

    public String getCounterpartyId() { return counterpartyId; }
    public void setCounterpartyId(String counterpartyId) { this.counterpartyId = counterpartyId; }
    public Double getCreditLimit() { return creditLimit; }
    public void setCreditLimit(Double creditLimit) { this.creditLimit = creditLimit; }
    public Double getUtilized() { return utilized; }
    public void setUtilized(Double utilized) { this.utilized = utilized; }
    public Double getAvailableHeadroom() { return availableHeadroom; }
    public void setAvailableHeadroom(Double availableHeadroom) { this.availableHeadroom = availableHeadroom; }
}
