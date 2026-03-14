package com.demo.broker.model;

public class OutstandingSummaryResponse {
    private String currency;
    private Integer dealCount;
    private Double totalOutstanding;
    private String topAccountId;
    private String topInvestorId;
    private String topIssuerId;

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public Integer getDealCount() { return dealCount; }
    public void setDealCount(Integer dealCount) { this.dealCount = dealCount; }
    public Double getTotalOutstanding() { return totalOutstanding; }
    public void setTotalOutstanding(Double totalOutstanding) { this.totalOutstanding = totalOutstanding; }
    public String getTopAccountId() { return topAccountId; }
    public void setTopAccountId(String topAccountId) { this.topAccountId = topAccountId; }
    public String getTopInvestorId() { return topInvestorId; }
    public void setTopInvestorId(String topInvestorId) { this.topInvestorId = topInvestorId; }
    public String getTopIssuerId() { return topIssuerId; }
    public void setTopIssuerId(String topIssuerId) { this.topIssuerId = topIssuerId; }
}
