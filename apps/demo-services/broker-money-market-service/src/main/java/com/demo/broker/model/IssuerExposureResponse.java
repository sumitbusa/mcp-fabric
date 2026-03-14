package com.demo.broker.model;

public class IssuerExposureResponse {
    private String issuerId;
    private String currency;
    private Integer dealCount;
    private Double totalOutstanding;
    private String topAccountId;

    public String getIssuerId() { return issuerId; }
    public void setIssuerId(String issuerId) { this.issuerId = issuerId; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public Integer getDealCount() { return dealCount; }
    public void setDealCount(Integer dealCount) { this.dealCount = dealCount; }
    public Double getTotalOutstanding() { return totalOutstanding; }
    public void setTotalOutstanding(Double totalOutstanding) { this.totalOutstanding = totalOutstanding; }
    public String getTopAccountId() { return topAccountId; }
    public void setTopAccountId(String topAccountId) { this.topAccountId = topAccountId; }
}
